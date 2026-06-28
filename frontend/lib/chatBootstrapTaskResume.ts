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
}: {
  activeTasks: BootstrapChatActiveTask[] | undefined;
  messages: Message[];
  alreadyResumedTaskIds?: Set<number>;
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
    const message = assistantByServerMessageId.get(task.assistant_message_id);
    if (!message) return;
    const initialContent = message.content || (message.reasoningContent ? `<think>${message.reasoningContent}</think>` : "");
    const hasPersistedVisibleState = !!(initialContent.trim() || message.reasoningContent?.trim());
    plan.push({
      task,
      message,
      // task.last_sequence_number is the producer progress, not necessarily the
      // UI/message content progress. If the user navigates away before the DB
      // ticker persists reasoning_content/content, resuming after the task's
      // latest sequence skips the reasoning deltas that were generated while the
      // page was away. In that empty-message case, replay from the beginning so
      // the restored assistant row catches up instead of showing a blank thought
      // block until final reconciliation.
      after: hasPersistedVisibleState ? (task.last_sequence_number || 0) : 0,
      initialContent,
    });
  });
  return plan;
}
