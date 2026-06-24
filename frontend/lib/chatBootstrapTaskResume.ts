import type { Message } from "@/lib/chatTypes";
import type { ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";

export type BootstrapChatActiveTask = NonNullable<NonNullable<ChatBootstrapPayload["active_tasks"]>["chat"]>[number];

export type BootstrapTaskResumePlanItem = {
  task: BootstrapChatActiveTask;
  message: Message;
  after: number;
  initialContent: string;
};

const RESUMABLE_BOOTSTRAP_TASK_STATUSES = new Set(["running", "streaming", "retrying"]);

export function buildBootstrapTaskResumePlan({
  activeTasks,
  messages,
  alreadyResumedTaskIds,
}: {
  activeTasks: BootstrapChatActiveTask[] | undefined;
  messages: Message[];
  alreadyResumedTaskIds: Set<number>;
}): BootstrapTaskResumePlanItem[] {
  if (!activeTasks?.length || !messages.length) return [];
  const assistantByServerMessageId = new Map<number, Message>();
  messages.forEach((message) => {
    if (message.role === "assistant" && typeof message.serverMessageId === "number") {
      assistantByServerMessageId.set(message.serverMessageId, message);
    }
  });
  const plan: BootstrapTaskResumePlanItem[] = [];
  activeTasks.forEach((task) => {
    if (!RESUMABLE_BOOTSTRAP_TASK_STATUSES.has(task.status)) return;
    if (alreadyResumedTaskIds.has(task.id)) return;
    const message = assistantByServerMessageId.get(task.assistant_message_id);
    if (!message) return;
    plan.push({
      task,
      message,
      after: task.last_sequence_number || 0,
      initialContent: message.content || "",
    });
  });
  return plan;
}
