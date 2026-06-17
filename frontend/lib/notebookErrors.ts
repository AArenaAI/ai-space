import { toast } from "sonner";
import { getGuestId } from "@/lib/guestId";

export type NotebookErrorCategory =
  | "auth"
  | "network"
  | "validation"
  | "file_size"
  | "file_type"
  | "file_processing"
  | "not_found"
  | "server"
  | "unknown";

export class NotebookUserError extends Error {
  category: NotebookErrorCategory;
  status?: number;
  raw?: string;

  constructor(message: string, options: { category?: NotebookErrorCategory; status?: number; raw?: string } = {}) {
    super(message);
    this.name = "NotebookUserError";
    this.category = options.category || "unknown";
    this.status = options.status;
    this.raw = options.raw;
  }
}

function classify(status?: number, raw = ""): NotebookErrorCategory {
  const text = raw.toLowerCase();
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 413 || /payload too large|request entity too large|file.*too large|文件.*过大|超过.*mb|超过.*kb/.test(text)) return "file_size";
  if (/unsupported|mime|file type|文件类型|不支持/.test(text)) return "file_type";
  if (/parse|embedding|index|解析|索引|处理/.test(text)) return "file_processing";
  if (status && status >= 500) return "server";
  if (status && status >= 400) return "validation";
  return "unknown";
}

function fallbackMessage(category: NotebookErrorCategory, fallback: string): string {
  switch (category) {
    case "auth":
      return "请先登录后再使用笔记本。";
    case "network":
      return "网络连接异常，请稍后重试。";
    case "file_size":
      return "文件过大，请压缩或换一个较小的文件。";
    case "file_type":
      return "暂不支持这个文件类型，请换一个支持的资料文件。";
    case "file_processing":
      return "资料处理失败，请稍后重试或重新上传。";
    case "not_found":
      return "笔记本不存在或你没有访问权限。";
    case "server":
      return "服务暂时不可用，请稍后重试。";
    case "validation":
      return fallback;
    default:
      return fallback;
  }
}

function pickMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  const value = obj.error || obj.message || obj.detail;
  return typeof value === "string" ? value : "";
}

export async function readNotebookApiError(response: Response, fallback = "请求失败"): Promise<NotebookUserError> {
  const raw = await response.text().catch(() => "");
  let payload: unknown = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = null; }
  }
  const rawMessage = pickMessage(payload) || raw;
  const category = classify(response.status, rawMessage);
  const message = rawMessage && rawMessage.length <= 80 ? rawMessage : fallbackMessage(category, fallback);
  return new NotebookUserError(message || fallbackMessage(category, fallback), {
    category,
    status: response.status,
    raw: rawMessage,
  });
}

export function normalizeNotebookError(error: unknown, fallback = "请求失败"): NotebookUserError {
  if (error instanceof NotebookUserError) return error;
  if (error instanceof TypeError) return new NotebookUserError(fallbackMessage("network", fallback), { category: "network", raw: error.message });
  if (error instanceof Error) {
    const category = classify(undefined, error.message);
    return new NotebookUserError(error.message || fallbackMessage(category, fallback), { category, raw: error.message });
  }
  if (typeof error === "string") {
    const category = classify(undefined, error);
    return new NotebookUserError(error || fallbackMessage(category, fallback), { category, raw: error });
  }
  return new NotebookUserError(fallback, { category: "unknown" });
}

export function showNotebookError(error: unknown, fallback = "请求失败") {
  const normalized = normalizeNotebookError(error, fallback);
  toast.error(normalized.message);
  return normalized;
}

export async function parseNotebookResponse<T>(response: Response, fallback = "请求失败"): Promise<T> {
  if (!response.ok) throw await readNotebookApiError(response, fallback);
  const text = await response.text().catch(() => "");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NotebookUserError(fallback, { category: "server", status: response.status, raw: text });
  }
}

const ALLOWED_NOTEBOOK_SOURCE_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".js", ".ts", ".go", ".py", ".java", ".cpp", ".c", ".h", ".hpp", ".rs",
  ".html", ".css", ".xml", ".yaml", ".yml", ".log", ".sql", ".sh", ".bash", ".tsx", ".jsx", ".vue",
  ".php", ".rb", ".swift", ".kt", ".scala", ".r", ".matlab", ".tex",
  ".pdf", ".docx", ".pptx", ".xlsx",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".mp4", ".mov",
]);

export function isNotebookSourceFileSupported(file: File): boolean {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  return ALLOWED_NOTEBOOK_SOURCE_EXTENSIONS.has(ext);
}

export function validateNotebookSourceFile(file: File): NotebookUserError | null {
  if (!isNotebookSourceFileSupported(file)) {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    return new NotebookUserError(`暂不支持 ${ext} 文件类型，请换一个支持的资料文件。`, { category: "file_type" });
  }
  return null;
}

export const NOTEBOOK_SOURCE_FILE_ACCEPT = [
  ".txt", ".md", ".json", ".csv", ".js", ".ts", ".go", ".py", ".java", ".cpp", ".c", ".h", ".hpp", ".rs",
  ".html", ".css", ".xml", ".yaml", ".yml", ".log", ".sql", ".sh", ".bash", ".tsx", ".jsx", ".vue",
  ".php", ".rb", ".swift", ".kt", ".scala", ".r", ".matlab", ".tex",
  ".pdf", ".docx", ".pptx", ".xlsx",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".mp4", ".mov",
].join(",");

export async function uploadNotebookSourceFile(file: File, workspaceId?: string | null) {
  const token = localStorage.getItem("token");
  const guestId = getGuestId();
  const headers: Record<string, string> = {};
  if (token && token !== "null" && token !== "undefined") headers.Authorization = `Bearer ${token}`;
  if (guestId) headers["X-Guest-ID"] = guestId;
  const form = new FormData();
  form.append("file", file);
  if (workspaceId) form.append("workspace_id", workspaceId);
  const response = await fetch("/api/files/upload", {
    method: "POST",
    headers,
    body: form,
  });
  const data = await parseNotebookResponse<{ public_id?: string }>(response, `${file.name} 上传失败，请重新选择文件。`);
  if (!data.public_id) throw new NotebookUserError(`${file.name} 上传失败，请重新选择文件。`, { category: "file_processing" });
  return data.public_id;
}
