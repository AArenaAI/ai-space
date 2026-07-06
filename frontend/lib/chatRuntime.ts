import { createConversationRuntimeStore } from "./chatRuntimeStore";
import { createStreamOwnerRegistry } from "./chatStreamOwnerRegistry";

export const chatRuntimeStore = createConversationRuntimeStore();

export const chatStreamOwnerRegistry = createStreamOwnerRegistry();

export { createConversationRuntimeStore } from "./chatRuntimeStore";
export type {
  ConversationRuntimeActivityTarget,
  ConversationRuntimeScrollState,
  ConversationRuntimeSlice,
  ConversationRuntimeSnapshot,
} from "./chatRuntimeStore";

export { createStreamOwnerRegistry } from "./chatStreamOwnerRegistry";
export type { ChatStreamOwner, ChatStreamOwnerAbortReason } from "./chatStreamOwnerRegistry";

export { mergeConversationSnapshot } from "./chatConversationSnapshotMerge";
export type {
  ChatConversationSnapshotLike,
  ChatConversationSnapshotMergeContext,
  ChatConversationSnapshotMergeDecision,
} from "./chatConversationSnapshotMerge";
