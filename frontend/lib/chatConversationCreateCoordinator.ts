export type CreateConversationBody = {
  title: string;
  model: string;
  skill_key?: string;
  workspace_id?: number;
};

export type CreatedConversationResponse = {
  id: number;
  title?: string;
  [key: string]: any;
};

export function buildCreateConversationBody(input: {
  title: string;
  model: string;
  skillKey?: string;
  workspaceId?: string | null;
}): CreateConversationBody {
  const body: CreateConversationBody = {
    title: input.title,
    model: input.model,
  };
  const skillKey = input.skillKey?.trim();
  if (skillKey) {
    body.skill_key = skillKey;
  }
  if (input.workspaceId) {
    body.workspace_id = Number(input.workspaceId);
  }
  return body;
}

export function buildCreateConversationUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/api/conversations`;
}

export async function runCreateConversationRequest(input: {
  apiBaseUrl: string;
  token: string;
  body: CreateConversationBody;
  fetchImpl?: typeof fetch;
}): Promise<CreatedConversationResponse | undefined> {
  const fetcher = input.fetchImpl || fetch;
  const res = await fetcher(buildCreateConversationUrl(input.apiBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("createConversation failed:", res.status, text);
    return undefined;
  }
  return await res.json();
}

export function resolveCreatedConversationTitle(data: CreatedConversationResponse, fallbackTitle: string): string {
  return data.title || fallbackTitle;
}

export function buildCreatedConversationUrl(input: {
  currentHref: string;
  conversationId: number;
  skillKey?: string;
}): string {
  const url = new URL(input.currentHref);
  url.searchParams.set("id", String(input.conversationId));
  if (input.skillKey && !url.searchParams.get("key")) {
    url.searchParams.set("key", input.skillKey);
  }
  return url.toString();
}

export function shouldCreateConversation(input: {
  token?: string | null;
}): boolean {
  return Boolean(input.token);
}
