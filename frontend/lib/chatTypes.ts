import type { ChatStatusTimelineStep } from "./chatStatusTimeline";

export interface SearchSource {
  title: string;
  url: string;
  description: string;
  snippet?: string;
  type?: string;
  page?: number;
  slide?: number;
  sheet_name?: string;
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
  reasoningContent?: string;
  model?: string;
  tokensUsed?: number;
  createdAt: number;
  completedAt?: number;
  generationStartedAt?: number;
  statusTimeline?: ChatStatusTimelineStep[];
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
  available?: boolean;
  status?: string;
  status_message?: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}
