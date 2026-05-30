export interface SearchSource {
  title: string;
  url: string;
  description: string;
}

export type ChatActivityStatus = {
  kind: "generating" | "reasoning" | "web_search" | "file_search" | "tool_call";
  status: "running" | "searching" | "completed" | "failed";
  label: string;
};

export type MessageFile = {
  public_id: string;
  type: string;
  filename: string;
};

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  createdAt: number;
  completedAt?: number;
  stopped?: boolean;
  search?: boolean;
  searchSources?: SearchSource[];
  searchSourcesCount?: number;
  searchStatus?: "searching" | "completed" | "failed";
  activityStatus?: ChatActivityStatus;
  files?: MessageFile[];
  errorCode?: string;
  retryable?: boolean;
  requestId?: string;
  serverMessageId?: number;
  backgroundTaskId?: string;
  generationTaskId?: number;
  useBackground?: boolean;
  isComplexTask?: boolean;
  lastSequence?: number;
  groupId?: number;
  groupIndex?: number;
  groupModels?: string[];
  userMessageId?: number;
}

export interface ChatModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  color: string;
  capabilities?: string[];
  supported_inputs?: string[];
  supported_file_extensions?: string[];
  supported_file_mime_types?: string[];
  file_accept?: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}
