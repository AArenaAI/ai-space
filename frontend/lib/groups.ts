import { Message } from "@/hooks/useChat";

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

function pushLegacyGroup(groups: InferredGroup[], userMessage: Message | null, assistants: Message[], nextId: () => number) {
  if (!userMessage) return;
  groups.push({
    id: nextId(),
    userMessage,
    assistantMessages: [...assistants],
    models: uniqueModels(assistants),
  });
}

/**
 * 优先按后端持久化 MessageGroup 分组；旧数据无 group_id 时再按相邻 user→assistant 推断。
 */
export function inferGroups(messages: Message[]): InferredGroup[] {
  const groups: InferredGroup[] = [];
  let fallbackGroupId = -1;
  const nextFallbackId = () => fallbackGroupId--;
  const pushedGroupIds = new Set<number>();

  let currentUser: Message | null = null;
  let currentAssistants: Message[] = [];

  const flushCurrent = () => {
    if (!currentUser) return;

    const groupedAssistants = currentAssistants.filter((m) => !!m.groupId);
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
        const sortedAssistants = [...assistants].sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
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
      pushLegacyGroup(groups, currentUser, currentAssistants, nextFallbackId);
    }
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushCurrent();
      currentUser = msg;
      currentAssistants = [];
    } else if (msg.role === "assistant") {
      currentAssistants.push(msg);
    }
  }

  flushCurrent();
  return groups;
}
