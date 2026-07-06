export type ChatConversationSnapshotLike = {
  conversationId?: number;
  snapshotVersion?: number;
  updatedAt?: number;
  messages?: Array<Record<string, unknown>>;
  pendingOptimisticMessages?: Array<Record<string, unknown>>;
  activeTaskIds?: Array<number | string>;
  [key: string]: unknown;
};

export type ChatConversationSnapshotMergeContext = {
  source: "bootstrap" | "restore" | "stream" | string;
  currentConversationId?: number;
  activeStreamTaskIds?: Array<number | string>;
};

export type ChatConversationSnapshotMergeDecision<T extends ChatConversationSnapshotLike> = {
  accepted: boolean;
  reason: string;
  snapshot: T;
};

function versionOf(snapshot?: ChatConversationSnapshotLike) {
  return typeof snapshot?.snapshotVersion === "number" ? snapshot.snapshotVersion : 0;
}

function updatedAtOf(snapshot?: ChatConversationSnapshotLike) {
  return typeof snapshot?.updatedAt === "number" ? snapshot.updatedAt : 0;
}

function hasPendingOptimistic(snapshot?: ChatConversationSnapshotLike) {
  return Array.isArray(snapshot?.pendingOptimisticMessages) && snapshot.pendingOptimisticMessages.length > 0;
}

function hasTask(snapshot: ChatConversationSnapshotLike | undefined, taskId: number | string) {
  if (!snapshot) return false;
  if (Array.isArray(snapshot.activeTaskIds) && snapshot.activeTaskIds.map(String).includes(String(taskId))) return true;
  return (snapshot.messages || []).some((message) => String(message.generation_task_id ?? message.taskId ?? "") === String(taskId));
}

function isRemoteTerminalCompleted(remote?: ChatConversationSnapshotLike, activeTaskIds: Array<number | string> = []) {
  if (!remote || activeTaskIds.length === 0) return false;
  return activeTaskIds.some((taskId) => (remote.messages || []).some((message) => {
    const messageTaskId = message.generation_task_id ?? message.taskId;
    const status = message.generation_status ?? message.status ?? message.phase;
    return String(messageTaskId) === String(taskId) && (status === "completed" || status === "failed" || status === "cancelled");
  }));
}

export function mergeConversationSnapshot<T extends ChatConversationSnapshotLike>(
  local: T,
  remote: T,
  context: ChatConversationSnapshotMergeContext,
): ChatConversationSnapshotMergeDecision<T> {
  if (context.currentConversationId !== undefined && remote.conversationId !== undefined && remote.conversationId !== context.currentConversationId) {
    return { accepted: false, reason: "remote_conversation_mismatch", snapshot: local };
  }

  const activeStreamTaskIds = context.activeStreamTaskIds || [];
  if (isRemoteTerminalCompleted(remote, activeStreamTaskIds)) {
    return { accepted: true, reason: "remote_completed_terminal_wins", snapshot: remote };
  }

  const remoteVersion = versionOf(remote);
  const localVersion = versionOf(local);
  const remoteUpdatedAt = updatedAtOf(remote);
  const localUpdatedAt = updatedAtOf(local);
  const remoteOlder = remoteVersion < localVersion || (remoteVersion === localVersion && remoteUpdatedAt < localUpdatedAt);

  if (remoteOlder && activeStreamTaskIds.some((taskId) => hasTask(local, taskId))) {
    return { accepted: false, reason: "remote_snapshot_older_than_active_stream", snapshot: local };
  }

  if (context.source === "bootstrap" && hasPendingOptimistic(local)) {
    return { accepted: false, reason: "local_optimistic_newer_than_bootstrap", snapshot: local };
  }

  if (remoteVersion > localVersion || remoteUpdatedAt >= localUpdatedAt) {
    return { accepted: true, reason: "remote_snapshot_newer", snapshot: remote };
  }

  return { accepted: false, reason: "local_snapshot_newer", snapshot: local };
}
