import { useState, useCallback } from "react";

export interface ImageChat {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  user_id: number;
}

export interface ImageChatMessage {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  image_url?: string;
  status: string;
  error_message?: string;
  created_at: string;
}

const API_BASE_URL = "";

async function safeJSON(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || text.trim() === "") {
    throw new Error(`服务器返回空响应 (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`服务器返回异常 (HTTP ${res.status}): ${text.slice(0, 100)}`);
  }
}

function getHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function useImageChats() {
  const [chats, setChats] = useState<ImageChat[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchChats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/image-chats`, { headers: getHeaders() });
      if (!res.ok) throw new Error("获取会话列表失败");
      const data = await safeJSON(res);
      setChats(data.chats || []);
    } catch (err: any) {
      console.error("fetch image chats error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createChat = useCallback(async (payload: {
    prompt: string;
    aspect_ratio?: string;
    resolution?: string;
    quality?: string;
    reference_image_urls?: string[];
  }) => {
    const res = await fetch(`${API_BASE_URL}/api/image-chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await safeJSON(res);
      throw new Error(err.error || "创建会话失败");
    }
    return safeJSON(res) as Promise<ImageChat>;
  }, []);

  const deleteChat = useCallback(async (id: number) => {
    const res = await fetch(`${API_BASE_URL}/api/image-chats/${id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("删除失败");
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateChatTitle = useCallback(async (id: number, title: string) => {
    const res = await fetch(`${API_BASE_URL}/api/image-chats/${id}`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("更新失败");
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  return { chats, loading, fetchChats, createChat, deleteChat, updateChatTitle };
}

export function useImageChatMessages() {
  const [messages, setMessages] = useState<ImageChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async (chatId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/image-chats/${chatId}/messages`, { headers: getHeaders() });
      if (!res.ok) throw new Error("获取消息失败");
      const data = await safeJSON(res);
      const msgs: ImageChatMessage[] = data.messages || [];
      setMessages(msgs);
      return msgs;
    } catch (err: any) {
      console.error("fetch messages error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (chatId: number, payload: {
    prompt: string;
    aspect_ratio?: string;
    resolution?: string;
    quality?: string;
    reference_image_urls?: string[];
  }) => {
    const res = await fetch(`${API_BASE_URL}/api/image-chats/${chatId}/messages`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await safeJSON(res);
      throw new Error(err.error || "发送失败");
    }
    return safeJSON(res) as Promise<{ message_id: number; chat_id: number; status: string }>;
  }, []);

  return { messages, loading, setMessages, fetchMessages, sendMessage };
}
