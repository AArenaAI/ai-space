import { buildChatRequestHeaders } from "./chatRequestBuilder";

export type CompareInitGroup = {
  id: number;
  conversation_id: number;
  user_message_id: number;
  group_models: string[];
};

export type CompareInitUserMessage = {
  id: number;
  conversation_id: number;
  role: "user";
  content: string;
  model?: string;
  created_at?: string;
};

export type CompareInitResponse = {
  conversation_id: number;
  user_message: CompareInitUserMessage;
  group: CompareInitGroup;
  compare_models: string[];
};

export type InitCompareRunOptions = {
  apiBaseUrl?: string;
  token?: string | null;
  guestId?: string;
  conversationId?: number;
  workspaceId?: string | number | null;
  content: string;
  model: string;
  compareModelIds: string[];
  skillKey?: string;
  fetchImpl?: typeof fetch;
};

export async function initCompareRun({
  apiBaseUrl = "",
  token,
  guestId,
  conversationId,
  workspaceId,
  content,
  model,
  compareModelIds,
  skillKey,
  fetchImpl = fetch,
}: InitCompareRunOptions): Promise<CompareInitResponse> {
  const headers = buildChatRequestHeaders({ token, guestId: guestId || "" });
  const numericWorkspaceId = typeof workspaceId === "string" ? Number(workspaceId) : workspaceId;
  const response = await fetchImpl(`${apiBaseUrl}/api/chat/compare/init`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversation_id: conversationId,
      workspace_id: Number.isFinite(numericWorkspaceId) ? numericWorkspaceId : undefined,
      content,
      model,
      compare_models: compareModelIds,
      skill_key: skillKey,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = errorBody.error || errorBody.code || "compare_init_failed";
    const errorMsg = errorBody.message || "初始化对比会话失败";
    throw Object.assign(new Error(errorMsg), { errorCode, status: response.status, needInvite: errorBody.need_invite });
  }
  return response.json();
}
