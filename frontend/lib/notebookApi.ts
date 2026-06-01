import type { Notebook, NotebookFile } from "@/lib/notebookTypes";
import { parseNotebookResponse } from "@/lib/notebookErrors";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchNotebooks(workspaceId?: number): Promise<Notebook[]> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspace_id", String(workspaceId));
  const response = await fetch(`/api/notebooks${params.toString() ? `?${params.toString()}` : ""}`, {
    headers: authHeaders(),
  });
  const data = await parseNotebookResponse<{ notebooks?: Notebook[] } | Notebook[]>(response, "加载笔记本失败");
  if (Array.isArray(data)) return data;
  return data.notebooks || [];
}

export async function createNotebook(input: { title: string; description?: string; workspace_id?: number }): Promise<Notebook> {
  const response = await fetch("/api/notebooks", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<Notebook>(response, "创建笔记本失败");
}

export async function fetchNotebook(id: number): Promise<{ notebook: Notebook; files: NotebookFile[] }> {
  const response = await fetch(`/api/notebooks/${id}`, { headers: authHeaders() });
  return parseNotebookResponse<{ notebook: Notebook; files: NotebookFile[] }>(response, "加载笔记本失败");
}

export async function updateNotebook(id: number, input: Partial<Pick<Notebook, "title" | "description" | "cover_icon">>): Promise<Notebook> {
  const response = await fetch(`/api/notebooks/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<Notebook>(response, "更新笔记本失败");
}

export async function deleteNotebook(id: number): Promise<void> {
  const response = await fetch(`/api/notebooks/${id}`, { method: "DELETE", headers: authHeaders() });
  await parseNotebookResponse(response, "删除笔记本失败");
}

export async function addNotebookFile(notebookId: number, publicId: string): Promise<NotebookFile> {
  const response = await fetch(`/api/notebooks/${notebookId}/files`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ public_id: publicId }),
  });
  return parseNotebookResponse<NotebookFile>(response, "添加资料失败");
}

export async function removeNotebookFile(notebookId: number, fileId: number): Promise<void> {
  const response = await fetch(`/api/notebooks/${notebookId}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  await parseNotebookResponse(response, "移除资料失败");
}
