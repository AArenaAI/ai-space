import type { Notebook, NotebookArtifact, NotebookFile, NotebookFileContent } from "@/lib/notebookTypes";
import { parseNotebookResponse } from "@/lib/notebookErrors";
import { apiFetch } from "@/lib/api/client";

export async function fetchNotebooks(workspaceId?: number): Promise<Notebook[]> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspace_id", String(workspaceId));
  const response = await apiFetch(`/notebooks${params.toString() ? `?${params.toString()}` : ""}`);
  const data = await parseNotebookResponse<{ notebooks?: Notebook[] } | Notebook[]>(response, "加载笔记本失败");
  if (Array.isArray(data)) return data;
  return data.notebooks || [];
}

export async function createNotebook(input: { title: string; description?: string; workspace_id?: number }): Promise<Notebook> {
  const response = await apiFetch("/notebooks", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<Notebook>(response, "创建笔记本失败");
}

export async function fetchNotebook(id: number): Promise<{ notebook: Notebook; files: NotebookFile[] }> {
  const response = await apiFetch(`/notebooks/${id}`, { cache: "no-store" });
  return parseNotebookResponse<{ notebook: Notebook; files: NotebookFile[] }>(response, "加载笔记本失败");
}

export async function updateNotebook(id: number, input: Partial<Pick<Notebook, "title" | "description" | "cover_icon">>): Promise<Notebook> {
  const response = await apiFetch(`/notebooks/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<Notebook>(response, "更新笔记本失败");
}

export async function deleteNotebook(id: number): Promise<void> {
  const response = await apiFetch(`/notebooks/${id}`, { method: "DELETE" });
  await parseNotebookResponse(response, "删除笔记本失败");
}

export async function addNotebookFile(notebookId: number, publicId: string): Promise<NotebookFile> {
  const response = await apiFetch(`/notebooks/${notebookId}/files`, {
    method: "POST",
    body: JSON.stringify({ public_id: publicId }),
  });
  return parseNotebookResponse<NotebookFile>(response, "添加资料失败");
}

export async function addNotebookUrlSource(notebookId: number, url: string): Promise<NotebookFile> {
  const response = await apiFetch(`/notebooks/${notebookId}/sources/url`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  return parseNotebookResponse<NotebookFile>(response, "添加网页资料失败");
}

export async function fetchNotebookFileContent(notebookId: number, fileId: number): Promise<NotebookFileContent> {
  const response = await apiFetch(`/notebooks/${notebookId}/files/${fileId}/content`, {
    cache: "no-store",
  });
  return parseNotebookResponse<NotebookFileContent>(response, "加载资料内容失败");
}

export async function updateNotebookFile(notebookId: number, fileId: number, input: { filename: string }): Promise<NotebookFile> {
  const response = await apiFetch(`/notebooks/${notebookId}/files/${fileId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<NotebookFile>(response, "重命名资料失败");
}

export async function reindexNotebookFile(notebookId: number, fileId: number): Promise<NotebookFile> {
  const response = await apiFetch(`/notebooks/${notebookId}/files/${fileId}/reindex`, {
    method: "POST",
  });
  return parseNotebookResponse<NotebookFile>(response, "重新索引资料失败");
}

export async function removeNotebookFile(notebookId: number, fileId: number): Promise<void> {
  const response = await apiFetch(`/notebooks/${notebookId}/files/${fileId}`, {
    method: "DELETE",
  });
  await parseNotebookResponse(response, "移除资料失败");
}

export async function fetchNotebookArtifacts(notebookId: number): Promise<NotebookArtifact[]> {
  const response = await apiFetch(`/notebooks/${notebookId}/artifacts`);
  const data = await parseNotebookResponse<{ artifacts?: NotebookArtifact[] } | NotebookArtifact[]>(response, "加载 Studio 输出失败");
  if (Array.isArray(data)) return data;
  return data.artifacts || [];
}

export async function createNotebookArtifact(input: {
  notebookId: number;
  type: string;
  title: string;
  subtitle?: string;
  content: unknown;
  source_count?: number;
}): Promise<NotebookArtifact> {
  const response = await apiFetch(`/notebooks/${input.notebookId}/artifacts`, {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      title: input.title,
      subtitle: input.subtitle,
      content: input.content,
      source_count: input.source_count || 0,
    }),
  });
  return parseNotebookResponse<NotebookArtifact>(response, "保存 Studio 输出失败");
}

export type NotebookReportFormatSuggestion = {
  id: string;
  title: string;
  description: string;
};

export async function suggestNotebookReportFormats(input: {
  notebookId: number;
  file_ids?: number[];
  language?: string;
}): Promise<NotebookReportFormatSuggestion[]> {
  const response = await apiFetch(`/notebooks/${input.notebookId}/report-formats`, {
    method: "POST",
    body: JSON.stringify({
      file_ids: input.file_ids || [],
      language: input.language,
    }),
  });
  const data = await parseNotebookResponse<{ formats?: NotebookReportFormatSuggestion[] } | NotebookReportFormatSuggestion[]>(response, "生成报告格式建议失败");
  if (Array.isArray(data)) return data;
  return data.formats || [];
}

export async function generateNotebookArtifact(input: {
  notebookId: number;
  type: string;
  file_ids?: number[];
  language?: string;
  orientation?: string;
  style?: string;
  detail_level?: string;
  prompt?: string;
  flashcard_count?: string;
  quiz_count?: string;
  difficulty?: string;
}): Promise<NotebookArtifact> {
  const response = await apiFetch(`/notebooks/${input.notebookId}/artifacts/generate`, {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      file_ids: input.file_ids || [],
      language: input.language,
      orientation: input.orientation,
      style: input.style,
      detail_level: input.detail_level,
      prompt: input.prompt,
      flashcard_count: input.flashcard_count,
      quiz_count: input.quiz_count,
      difficulty: input.difficulty,
    }),
  });
  return parseNotebookResponse<NotebookArtifact>(response, "生成 Studio 输出失败");
}

export async function updateNotebookArtifact(notebookId: number, artifactId: number, input: { title: string; subtitle?: string }): Promise<NotebookArtifact> {
  const response = await apiFetch(`/notebooks/${notebookId}/artifacts/${artifactId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return parseNotebookResponse<NotebookArtifact>(response, "更新 Studio 输出失败");
}

export async function deleteNotebookArtifact(notebookId: number, artifactId: number): Promise<void> {
  const response = await apiFetch(`/notebooks/${notebookId}/artifacts/${artifactId}`, {
    method: "DELETE",
  });
  await parseNotebookResponse(response, "删除 Studio 输出失败");
}
