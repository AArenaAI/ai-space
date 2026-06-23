import { Message } from "@/lib/chatTypes";

export interface InferredGroup {
  id: number;
  userMessage: Message;
  assistantMessages: Message[];
  models: string[];
}

/**
 * 从 messages 数组推断 Group 结构
 *
 * 规则：
 * - user 消息开始一个新 Group
 * - 后续连续的 assistant 消息属于该 Group
 * - 下一个 user 消息开始新 Group
 *
 * 单聊：[user, assistant, user, assistant] → 2 个 Group，每个 1 个 assistant
 * 对比：[user, assistant_A, assistant_B, user, assistant_A, assistant_B] → 2 个 Group，每个 2 个 assistant
 */
function uniqueModels(messages: Message[], fallback?: string[]): string[] {
  const models: string[] = [];
  const add = (model?: string) => {
    if (model && !models.includes(model)) models.push(model);
  };
  fallback?.forEach(add);
  messages.forEach((m) => add(m.model));
  return models;
}

export function messageRecency(message: Message): number {
  return message.completedAt || message.createdAt || Number(message.serverMessageId || 0);
}

export function dedupeAssistantsByModel(messages: Message[]): Message[] {
  const byModel = new Map<string, Message>();
  const passthrough: Message[] = [];

  for (const message of messages) {
    const key = message.model || (typeof message.groupIndex === "number" ? `slot:${message.groupIndex}` : "");
    if (!key) {
      passthrough.push(message);
      continue;
    }
    const current = byModel.get(key);
    if (!current || messageRecency(message) >= messageRecency(current)) {
      byModel.set(key, message);
    }
  }

  return [...Array.from(byModel.values()), ...passthrough].sort((a, b) => {
    const ai = typeof a.groupIndex === "number" ? a.groupIndex : Number.MAX_SAFE_INTEGER;
    const bi = typeof b.groupIndex === "number" ? b.groupIndex : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return messageRecency(a) - messageRecency(b);
  });
}

function pushLegacyGroup(groups: InferredGroup[], userMessage: Message | null, assistants: Message[], nextId: () => number) {
  if (!userMessage) return;
  const assistantMessages = dedupeAssistantsByModel(assistants);
  groups.push({
    id: nextId(),
    userMessage,
    assistantMessages,
    models: uniqueModels(assistantMessages),
  });
}

/**
 * 优先按后端持久化 MessageGroup 的 user_message_id 归组；旧数据无该字段时再按相邻 user→assistant 推断。
 */
export function inferGroups(messages: Message[]): InferredGroup[] {
  const groups: InferredGroup[] = [];
  let fallbackGroupId = -1;
  const nextFallbackId = () => fallbackGroupId--;
  const pushedGroupIds = new Set<number>();
  const authoritativeUserIds = new Set<number>();
  const userByServerId = new Map<number, Message>();

  for (const msg of messages) {
    if (msg.role === "user" && msg.serverMessageId) {
      userByServerId.set(msg.serverMessageId, msg);
    }
  }

  const authoritativeAssistants = messages.filter(
    (msg) => msg.role === "assistant" && !!msg.groupId && !!msg.userMessageId && userByServerId.has(msg.userMessageId)
  );
  const authoritativeByGroupId = new Map<number, Message[]>();
  for (const msg of authoritativeAssistants) {
    if (!msg.groupId) continue;
    const list = authoritativeByGroupId.get(msg.groupId) || [];
    list.push(msg);
    authoritativeByGroupId.set(msg.groupId, list);
  }

  for (const [id, assistants] of Array.from(authoritativeByGroupId.entries())) {
    const sortedAssistants = dedupeAssistantsByModel(assistants);
    const userMessageId = sortedAssistants[0]?.userMessageId;
    const userMessage = userMessageId ? userByServerId.get(userMessageId) : undefined;
    if (!userMessage) continue;
    pushedGroupIds.add(id);
    if (userMessage.serverMessageId) authoritativeUserIds.add(userMessage.serverMessageId);
    groups.push({
      id,
      userMessage,
      assistantMessages: sortedAssistants,
      models: uniqueModels(sortedAssistants, sortedAssistants[0]?.groupModels),
    });
  }

  let currentUser: Message | null = null;
  let currentAssistants: Message[] = [];

  const flushCurrent = () => {
    if (!currentUser) return;
    if (currentAssistants.length === 0 && currentUser.serverMessageId && authoritativeUserIds.has(currentUser.serverMessageId)) return;

    const groupedAssistants = currentAssistants.filter((m) => !!m.groupId && !pushedGroupIds.has(m.groupId));
    if (groupedAssistants.length > 0) {
      const byGroupId = new Map<number, Message[]>();
      for (const msg of groupedAssistants) {
        if (!msg.groupId) continue;
        const list = byGroupId.get(msg.groupId) || [];
        list.push(msg);
        byGroupId.set(msg.groupId, list);
      }

      for (const [id, assistants] of Array.from(byGroupId.entries())) {
        if (pushedGroupIds.has(id)) continue;
        pushedGroupIds.add(id);
        const sortedAssistants = dedupeAssistantsByModel(assistants);
        groups.push({
          id,
          userMessage: currentUser,
          assistantMessages: sortedAssistants,
          models: uniqueModels(sortedAssistants, sortedAssistants[0]?.groupModels),
        });
      }

      const legacyAssistants = currentAssistants.filter((m) => !m.groupId);
      if (legacyAssistants.length > 0) {
        pushLegacyGroup(groups, currentUser, legacyAssistants, nextFallbackId);
      }
    } else {
      const legacyAssistants = currentAssistants.filter((m) => !m.groupId || !pushedGroupIds.has(m.groupId));
      pushLegacyGroup(groups, currentUser, legacyAssistants, nextFallbackId);
    }
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushCurrent();
      currentUser = msg;
      currentAssistants = [];
    } else if (msg.role === "assistant" && (!msg.groupId || !pushedGroupIds.has(msg.groupId))) {
      currentAssistants.push(msg);
    }
  }

  flushCurrent();
  return groups.sort((a, b) => messageRecency(a.userMessage) - messageRecency(b.userMessage));
}
