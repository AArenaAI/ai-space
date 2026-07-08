import type { Message } from "./chatTypes";

export function getMessageRenderKey(message: Message): string {
  if (message.clientMessageId) return message.clientMessageId;
  if (message.serverMessageId) return `server:${message.serverMessageId}`;
  return message.id;
}

export function sameChatMessage(a: Partial<Message>, b: Partial<Message>): boolean {
  if (a.serverMessageId && b.serverMessageId) return a.serverMessageId === b.serverMessageId;
  if (a.clientMessageId && b.clientMessageId) return a.clientMessageId === b.clientMessageId;
  if (a.localRunId && b.localRunId && a.role && b.role) return a.localRunId === b.localRunId && a.role === b.role;
  return Boolean(a.id && b.id && a.id === b.id);
}

export function bindServerMessage<T extends Message>(local: T, serverPatch: Partial<Message>): T {
  return {
    ...local,
    ...serverPatch,
    id: local.id,
    clientMessageId: local.clientMessageId,
    localRunId: local.localRunId,
  } as T;
}

export function makeClientMessageId(id: string) {
  return id.startsWith("client:") ? id : `client:${id}`;
}

export function makeLocalRunId(id: string) {
  return id.startsWith("run:") ? id : `run:${id}`;
}
