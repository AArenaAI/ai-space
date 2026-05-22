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
export function inferGroups(messages: Message[]): InferredGroup[] {
  const groups: InferredGroup[] = [];
  let groupId = 1;
  let currentUser: Message | null = null;
  let currentAssistants: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (currentUser) {
        const models = currentAssistants
          .map((m) => m.model)
          .filter((m): m is string => !!m);
        const uniqueModels: string[] = [];
        for (const m of models) {
          if (!uniqueModels.includes(m)) uniqueModels.push(m);
        }
        groups.push({
          id: groupId++,
          userMessage: currentUser,
          assistantMessages: [...currentAssistants],
          models: uniqueModels,
        });
      }
      currentUser = msg;
      currentAssistants = [];
    } else if (msg.role === "assistant") {
      currentAssistants.push(msg);
    }
  }

  if (currentUser) {
    const models = currentAssistants
      .map((m) => m.model)
      .filter((m): m is string => !!m);
    const uniqueModels: string[] = [];
    for (const m of models) {
      if (!uniqueModels.includes(m)) uniqueModels.push(m);
    }
    groups.push({
      id: groupId++,
      userMessage: currentUser,
      assistantMessages: [...currentAssistants],
      models: uniqueModels,
    });
  }

  return groups;
}
