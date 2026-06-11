export type NotebookFile = {
  id: number;
  notebook_id: number;
  file_id: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  file: {
    id: number;
    public_id: string;
    filename: string;
    mime_type: string;
    size: number;
    parse_status: "pending" | "parsing" | "done" | "error" | "unsupported" | string;
    embedding_status: "pending" | "indexing" | "done" | "error" | "skipped" | string;
    error_message?: string;
    summary?: string;
    page_count?: number;
    token_count?: number;
    created_at: string;
    updated_at: string;
  };
};

export type Notebook = {
  id: number;
  user_id: number;
  workspace_id: number;
  title: string;
  description: string;
  cover_icon: string;
  created_at: string;
  updated_at: string;
  file_count?: number;
  files?: NotebookFile[];
};

export type NotebookFileContentChunk = {
  index: number;
  page?: number;
  slide?: number;
  sheet_name?: string;
  block_type?: string;
  content: string;
};

export interface NotebookFileContent {
  file: NotebookFile["file"];
  content: string;
  chunks: NotebookFileContentChunk[];
  has_more?: boolean;
}

export type NotebookArtifactType = "data-table" | "summary" | "faq" | "briefing" | "mindmap" | "slides" | string;

export interface NotebookArtifact {
  id: number;
  notebook_id: number;
  type: NotebookArtifactType;
  title: string;
  subtitle?: string;
  content: unknown;
  source_count: number;
  created_at: string;
  updated_at: string;
}
