import { getGuestId } from "@/lib/guestId";
import { ensureAuthSession, readAuthState } from "@/lib/auth/state";

export class ApiClientError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

function isFormBody(body: BodyInit | null | undefined) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function normalizeApiPath(path: string) {
  if (path.startsWith("/api/")) return path;
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return { message: `请求失败（${response.status}）`, body: undefined };
  try {
    const json = JSON.parse(text);
    return { message: json?.error || json?.message || text, body: json };
  } catch {
    return { message: text, body: text };
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  await ensureAuthSession();
  const headers = new Headers(options.headers);
  const body = options.body as BodyInit | null | undefined;

  if (!headers.has("Authorization")) {
    const token = readAuthState().token;
    if (token && token !== "null" && token !== "undefined") {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  if (!headers.has("X-Guest-ID")) {
    const guestId = getGuestId();
    if (guestId) headers.set("X-Guest-ID", guestId);
  }
  if (body !== undefined && !isFormBody(body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(normalizeApiPath(path), {
    ...options,
    credentials: options.credentials || "include",
    headers,
  });
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const { message, body } = await readError(response);
    throw new ApiClientError(message, response.status, body);
  }
  return response.json() as Promise<T>;
}

export async function apiVoid(path: string, options: RequestInit = {}): Promise<void> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const { message, body } = await readError(response);
    throw new ApiClientError(message, response.status, body);
  }
}
