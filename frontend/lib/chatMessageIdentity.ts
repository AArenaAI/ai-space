import type { Message } from "./chatTypes";

export type ChatMessageIdentityMatchReason = "serverMessageId" | "clientMessageId" | "localRunIdRole" | "legacyId" | "none";

export function getMessageRenderKey(message: Message): string {
  if (message.clientMessageId) return message.clientMessageId;
  if (message.serverMessageId) return `server:${message.serverMessageId}`;
  if (message.localRunId && message.role) return `run:${message.localRunId}:${message.role}`;
  return message.id;
}

export function getChatMessageIdentityMatchReason(a: Partial<Message>, b: Partial<Message>): ChatMessageIdentityMatchReason {
  if (a.serverMessageId && b.serverMessageId && a.serverMessageId === b.serverMessageId) return "serverMessageId";
  if (a.clientMessageId && b.clientMessageId && a.clientMessageId === b.clientMessageId) return "clientMessageId";
  if (a.localRunId && b.localRunId && a.role && b.role && a.localRunId === b.localRunId && a.role === b.role) return "localRunIdRole";
  if (a.id && b.id && a.id === b.id) return "legacyId";
  return "none";
}

export function sameChatMessage(a: Partial<Message>, b: Partial<Message>): boolean {
  return getChatMessageIdentityMatchReason(a, b) !== "none";
}

export function bindServerMessage<T extends Message>(local: T, serverPatch: Partial<Message>): T {
  return {
    ...local,
    ...serverPatch,
    id: local.id,
    clientMessageId: local.clientMessageId || serverPatch.clientMessageId,
    localRunId: local.localRunId || serverPatch.localRunId,
  } as T;
}

export function mergeChatMessagesByIdentity<T extends Message>(localMessages: T[], incomingMessages: T[]): T[] {
  const merged = [...localMessages];
  for (const incoming of incomingMessages) {
    const index = merged.findIndex((existing) => sameChatMessage(existing, incoming));
    if (index === -1) {
      merged.push(incoming);
      continue;
    }
    merged[index] = bindServerMessage(merged[index], incoming);
  }
  return merged;
}

export function makeClientMessageId(id: string) {
  return id.startsWith("client:") ? id : `client:${id}`;
}

export function makeLocalRunId(id: string) {
  return id.startsWith("run:") ? id : `run:${id}`;
}
