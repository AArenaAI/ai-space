import { useCallback, useState } from "react";
import { readApiError } from "@/lib/errors";

export interface VideoChat {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  user_id: number;
  cover_video?: string;
  status?: string;
}

export interface VideoChatMessage {
  id: number;
  chat_id: number;
  role: "user" | "assistant" | string;
  content: string;
  status?: string;
  error_message?: string;
  video_url?: string;
  last_frame_url?: string;
  model?: string;
  ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
  task_id?: string;
  generation_id?: number;
  created_at: string;
  updated_at?: string;
}

export interface VideoChatPayload {
  prompt: string;
  model: string;
  ratio?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
  reference_image_urls?: string[];
  reference_image_roles?: Array<"reference_image" | "first_frame" | "last_frame">;
  reference_video_urls?: string[];
  reference_image_role_mode?: "auto" | "reference" | "first_frame" | "first_last_frame";
}

const API_BASE_URL = "";

async function safeJSON(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || text.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw await readApiError(new Response(text, { status: res.status, statusText: res.statusText }));
  }
}

function getHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function useVideoChats() {
  const [chats, setChats] = useState<VideoChat[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchChats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-chats`, { headers: getHeaders() });
      if (!res.ok) throw await readApiError(res);
      const data = await safeJSON(res);
      setChats(data.chats || []);
      return (data.chats || []) as VideoChat[];
    } catch (err) {
      console.error("fetch video chats error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createChat = useCallback(async (payload: VideoChatPayload) => {
    const res = await fetch(`${API_BASE_URL}/api/video-chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await readApiError(res);
    return safeJSON(res) as Promise<{ chat: VideoChat; chat_id: number; message_id: number; task_id: string; status: string }>;
  }, []);

  const deleteChat = useCallback(async (id: number) => {
    const res = await fetch(`${API_BASE_URL}/api/video-chats/${id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) throw await readApiError(res);
    setChats((prev) => prev.filter((chat) => chat.id !== id));
  }, []);

  const updateChatTitle = useCallback(async (id: number, title: string) => {
    const res = await fetch(`${API_BASE_URL}/api/video-chats/${id}`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw await readApiError(res);
    setChats((prev) => prev.map((chat) => (chat.id === id ? { ...chat, title } : chat)));
  }, []);

  return { chats, loading, fetchChats, createChat, deleteChat, updateChatTitle };
}

export function useVideoChatMessages() {
  const [messages, setMessages] = useState<VideoChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async (chatId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-chats/${chatId}/messages`, { headers: getHeaders() });
      if (!res.ok) throw await readApiError(res);
      const data = await safeJSON(res);
      const msgs: VideoChatMessage[] = data.messages || [];
      setMessages(msgs);
      return msgs;
    } catch (err) {
      console.error("fetch video chat messages error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (chatId: number, payload: VideoChatPayload) => {
    const res = await fetch(`${API_BASE_URL}/api/video-chats/${chatId}/messages`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await readApiError(res);
    return safeJSON(res) as Promise<{ message_id: number; chat_id: number; task_id: string; status: string }>;
  }, []);

  return { messages, loading, setMessages, fetchMessages, sendMessage };
}
