"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Clock3,
  Download,
  FileText,
  History as HistoryIcon,
  Loader2,
  MessageSquare,
  PenLine,
  Trash2,
  Plus,
  Search,
  Send,
  Sparkles,
  Undo2,
  Redo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { consumeChatStream } from "@/lib/chatStream";
import { getErrorMessage, normalizeError, readApiError, showUserError } from "@/lib/errors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import HistoryDrawer, { type HistoryItem as DrawerHistoryItem } from "@/components/ui/HistoryDrawer";
import { apiFetch } from "@/lib/api/client";

const WRITER_MODEL = "gpt-5.5";
const WRITER_SKILL_KEY = "ai-writing-assistant";

type WriterMode = "writing" | "chat";

type Conversation = {
  id: number;
  title: string;
  model?: string;
  skill_key?: string;
  created_at?: string;
  updated_at?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: WriterMode;
  createdAt: number;
};

type WriterDoc = {
  conversationId: number;
  title: string;
  content: string;
  updatedAt: string;
};

type DocSnapshot = Pick<WriterDoc, "title" | "content">;

type SmoothBuffer = {
  displayed: string;
  target: string;
  timer: ReturnType<typeof setTimeout> | null;
  apply: (text: string) => void;
  drainResolvers: Array<() => void>;
};

const quickPromptKeys = ["writer.quickPrompt.productLaunch", "writer.quickPrompt.businessPlan", "writer.quickPrompt.xiaohongshu", "writer.quickPrompt.polish"];
const ASSISTANT_MIN_WIDTH = 320;
const ASSISTANT_MAX_WIDTH = 680;
const ASSISTANT_DEFAULT_WIDTH = 420;

function countWords(text: string): number {
  if (!text) return 0;
  const t = text.replace(/\s/g, "");
  const cjk = (t.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const enWords = (t.match(/[a-zA-Z]+/g) || []).length;
  const numWords = (t.match(/\d+/g) || []).length;
  return cjk + enWords + numWords;
}

function storageKey(id: number) {
  return `ai-writing-assistant-doc-${id}`;
}

function messagesStorageKey(id: number) {
  return `ai-writing-assistant-messages-${id}`;
}

function readStoredDoc(id: number): WriterDoc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) as WriterDoc : null;
  } catch {
    return null;
  }
}

function getDocumentDisplayTitle(doc: Conversation, t: (key: string) => string) {
  return readStoredDoc(doc.id)?.title || doc.title || t("writer.defaultTitle");
}

function historyStorageKey(id: number) {
  return `ai-writing-assistant-history-${id}`;
}

function readDocHistory(id: number): { undo: DocSnapshot[]; redo: DocSnapshot[] } {
  if (typeof window === "undefined") return { undo: [], redo: [] };
  try {
    const raw = localStorage.getItem(historyStorageKey(id));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      undo: Array.isArray(parsed?.undo) ? parsed.undo : [],
      redo: Array.isArray(parsed?.redo) ? parsed.redo : [],
    };
  } catch {
    return { undo: [], redo: [] };
  }
}

function writeDocHistory(id: number, undo: DocSnapshot[], redo: DocSnapshot[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(historyStorageKey(id), JSON.stringify({ undo, redo }));
}

function isSameSnapshot(a?: DocSnapshot, b?: DocSnapshot) {
  return !!a && !!b && a.title === b.title && a.content === b.content;
}

function pushSnapshot(stack: DocSnapshot[], snapshot: DocSnapshot) {
  const last = stack[stack.length - 1];
  if (isSameSnapshot(last, snapshot)) return stack;
  return [...stack, snapshot].slice(-50);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGenerationTaskId(meta: Record<string, unknown>): number | null {
  const task = (meta._generation_task || meta._background_task) as Record<string, unknown> | undefined;
  const id = Number(task?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function extractTextFromChatResponse(data: any): string {
  const choice = data?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || data?.message?.content || data?.content || "";
}

async function fetchWritingAssistantStream(payload: Record<string, any>): Promise<Response> {
  const initResponse = await apiFetch("/chat/init", {
    method: "POST",
    body: JSON.stringify({ ...payload, stream: true, init_only: true }),
  });
  if (!initResponse.ok) return initResponse;
  const init = await initResponse.json();
  const taskId = Number(init?.task_id || init?.assistant_message?.generation_task_id || 0);
  if (!taskId) {
    return new Response(JSON.stringify(init), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return apiFetch(`/tasks/${taskId}/stream?after=0`);
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function extractTag(text: string, tag: "TITLE" | "CONTENT" | "REPLY", allowOpen = false): string | undefined {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const start = text.indexOf(openTag);
  if (start < 0) return undefined;
  const contentStart = start + openTag.length;
  const end = text.indexOf(closeTag, contentStart);
  if (end >= 0) return text.slice(contentStart, end).trim();
  if (!allowOpen) return undefined;

  const nextTag = text.slice(contentStart).search(/<\/?(?:TITLE|CONTENT|REPLY)>/);
  const openContent = nextTag >= 0
    ? text.slice(contentStart, contentStart + nextTag)
    : text.slice(contentStart);
  return openContent.trim();
}

function parseWriterTaggedResult(raw: string, allowOpen = false): { reply?: string; title?: string; content?: string } {
  return {
    reply: extractTag(raw, "REPLY", allowOpen),
    title: extractTag(raw, "TITLE", allowOpen),
    content: extractTag(raw, "CONTENT", allowOpen),
  };
}

function parseWriterResult(raw: string, t: (key: string) => string): { reply: string; title?: string; content?: string } {
  const cleaned = stripJsonFence(raw);
  const tagged = parseWriterTaggedResult(cleaned);
  if (tagged.title || tagged.content || tagged.reply) {
    return {
      reply: tagged.reply || t("writer.writingDone"),
      title: tagged.title,
      content: tagged.content,
    };
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: parsed.reply || t("writer.writingDoneShort"),
      title: parsed.title || parsed.document?.title,
      content: parsed.content || parsed.document?.content,
    };
  } catch {
    const lines = raw.split("\n");
    const titleLineIndex = lines.findIndex((line) => /^\s*标题\s*[:：]/.test(line));
    const title = titleLineIndex >= 0
      ? lines[titleLineIndex].replace(/^\s*标题\s*[:：]\s*/, "").trim()
      : undefined;
    const content = titleLineIndex >= 0
      ? lines.filter((_, index) => index !== titleLineIndex).join("\n").replace(/^\s*正文\s*[:：]\s*/m, "").trim()
      : raw.trim();
    return {
      reply: t("writer.contentGenerated"),
      title,
      content,
    };
  }
}

function formatDate(value?: string, justNowLabel = "\u521a\u521a") {
  if (!value) return justNowLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return justNowLabel;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function WritingAssistantPage() {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<Conversation[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [mode, setMode] = useState<WriterMode>("writing");
  const [homeInput, setHomeInput] = useState("");
  const [activeDoc, setActiveDoc] = useState<WriterDoc | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [undoStack, setUndoStack] = useState<DocSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocSnapshot[]>([]);
  const [assistantWidth, setAssistantWidth] = useState(ASSISTANT_DEFAULT_WIDTH);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditSnapshotRef = useRef<DocSnapshot | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const smoothBuffersRef = useRef<Record<string, SmoothBuffer>>({});

  const resolveSmoothDrains = (buffer: SmoothBuffer) => {
    const resolvers = buffer.drainResolvers.splice(0);
    resolvers.forEach((resolve) => resolve());
  };

  const pumpSmoothBuffer = (key: string) => {
    const buffer = smoothBuffersRef.current[key];
    if (!buffer) return;
    if (buffer.displayed.length >= buffer.target.length) {
      buffer.timer = null;
      resolveSmoothDrains(buffer);
      return;
    }

    const remaining = buffer.target.length - buffer.displayed.length;
    const step = remaining > 600 ? 12 : remaining > 240 ? 8 : remaining > 80 ? 5 : 2;
    buffer.displayed = buffer.target.slice(0, buffer.displayed.length + step);
    buffer.apply(buffer.displayed);
    buffer.timer = setTimeout(() => pumpSmoothBuffer(key), 18);
  };

  const enqueueSmoothText = (key: string, target: string, apply: (text: string) => void) => {
    let buffer = smoothBuffersRef.current[key];
    if (!buffer) {
      buffer = { displayed: "", target: "", timer: null, apply, drainResolvers: [] };
      smoothBuffersRef.current[key] = buffer;
    }
    buffer.apply = apply;
    buffer.target = target;
    if (!buffer.timer) pumpSmoothBuffer(key);
  };

  const drainSmoothText = (key: string) => {
    const buffer = smoothBuffersRef.current[key];
    if (!buffer || buffer.displayed.length >= buffer.target.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      buffer.drainResolvers.push(resolve);
    });
  };

  const clearSmoothText = (key: string) => {
    const buffer = smoothBuffersRef.current[key];
    if (!buffer) return;
    if (buffer.timer) clearTimeout(buffer.timer);
    resolveSmoothDrains(buffer);
    delete smoothBuffersRef.current[key];
  };

  const handleAssistantResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = assistantWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, startWidth - (moveEvent.clientX - startX)));
      setAssistantWidth(nextWidth);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };


  const sortedDocuments = useMemo(
    () => documents.filter((item) => item.skill_key === WRITER_SKILL_KEY).sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()),
    [documents]
  );

  const filteredDocuments = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) return sortedDocuments;
    return sortedDocuments.filter((item) => getDocumentDisplayTitle(item, t).toLowerCase().includes(keyword));
  }, [historySearch, sortedDocuments]);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await apiFetch("/conversations?limit=200");
      if (!res.ok) throw await readApiError(res);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.conversations || [];
      setDocuments(list);
    } catch (e) {
      showUserError(e, { module: "chat", fallbackTitle: t("writer.error.loadHistory"), fallbackMessage: t("writer.error.loadHistory") });
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isGenerating]);

  useEffect(() => {
    if (!activeDoc) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey(activeDoc.conversationId), JSON.stringify(activeDoc));
    }, 350);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [activeDoc]);

  useEffect(() => {
    if (!activeDoc) return;
    localStorage.setItem(messagesStorageKey(activeDoc.conversationId), JSON.stringify(messages));
  }, [messages, activeDoc]);

  const replaceHistory = (undo: DocSnapshot[], redo: DocSnapshot[], docId = activeDoc?.conversationId) => {
    setUndoStack(undo);
    setRedoStack(redo);
    if (docId) writeDocHistory(docId, undo, redo);
  };

  const recordUndoSnapshot = (snapshot: DocSnapshot, docId = activeDoc?.conversationId) => {
    const nextUndo = pushSnapshot(undoStack, snapshot);
    replaceHistory(nextUndo, [], docId);
  };

  const flushPendingEditSnapshot = (docId = activeDoc?.conversationId) => {
    if (!pendingEditSnapshotRef.current) return;
    recordUndoSnapshot(pendingEditSnapshotRef.current, docId);
    pendingEditSnapshotRef.current = null;
    if (editHistoryTimerRef.current) {
      clearTimeout(editHistoryTimerRef.current);
      editHistoryTimerRef.current = null;
    }
  };

  const updateActiveDoc = (patch: Partial<Pick<WriterDoc, "title" | "content">>) => {
    if (!activeDoc) return;
    const nextDoc = { ...activeDoc, ...patch, updatedAt: new Date().toISOString() };
    if (nextDoc.title === activeDoc.title && nextDoc.content === activeDoc.content) return;
    if (!pendingEditSnapshotRef.current) {
      pendingEditSnapshotRef.current = { title: activeDoc.title, content: activeDoc.content };
    }
    if (editHistoryTimerRef.current) clearTimeout(editHistoryTimerRef.current);
    const docId = activeDoc.conversationId;
    editHistoryTimerRef.current = setTimeout(() => flushPendingEditSnapshot(docId), 900);
    setActiveDoc(nextDoc);
  };

  const undoDoc = () => {
    flushPendingEditSnapshot();
    if (!activeDoc || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const nextUndo = undoStack.slice(0, -1);
    const nextRedo = pushSnapshot(redoStack, { title: activeDoc.title, content: activeDoc.content });
    replaceHistory(nextUndo, nextRedo, activeDoc.conversationId);
    setActiveDoc({ ...activeDoc, ...previous, updatedAt: new Date().toISOString() });
  };

  const redoDoc = () => {
    flushPendingEditSnapshot();
    if (!activeDoc || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const nextRedo = redoStack.slice(0, -1);
    const nextUndo = pushSnapshot(undoStack, { title: activeDoc.title, content: activeDoc.content });
    replaceHistory(nextUndo, nextRedo, activeDoc.conversationId);
    setActiveDoc({ ...activeDoc, ...next, updatedAt: new Date().toISOString() });
  };

  const createConversation = async (title: string) => {
    const res = await apiFetch("/conversations", {
      method: "POST",
      body: JSON.stringify({ title: title || t("writer.title"), model: WRITER_MODEL, skill_key: WRITER_SKILL_KEY }),
    });
    if (!res.ok) throw await readApiError(res);
    return (await res.json()) as Conversation;
  };

  const createBlankDoc = async () => {
    try {
      const conv = await createConversation(t("writer.defaultTitle"));
      const doc: WriterDoc = { conversationId: conv.id, title: t("writer.defaultTitle"), content: "", updatedAt: new Date().toISOString() };
      localStorage.setItem(storageKey(conv.id), JSON.stringify(doc));
      writeDocHistory(conv.id, [], []);
      setDocuments((prev) => [conv, ...prev]);
      setActiveDoc(doc);
      replaceHistory([], [], conv.id);
      setMessages([]);
      setChatInput("");
    } catch (e) {
      showUserError(e, { module: "chat", fallbackTitle: t("writer.error.createBlank"), fallbackMessage: t("writer.error.createBlank") });
    }
  };

  const applyWriterStream = (baseDoc: WriterDoc, fullText: string) => {
    const partial = parseWriterTaggedResult(fullText, true);
    if (!partial.title && !partial.content) return;
    setActiveDoc((prev) => {
      if (!prev || prev.conversationId !== baseDoc.conversationId) return prev;
      return {
        ...prev,
        title: partial.title || prev.title,
        content: partial.content || prev.content,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const finalizeWriterDoc = (baseDoc: WriterDoc, result: { title?: string; content?: string }) => {
    const nextDoc = {
      ...baseDoc,
      title: result.title || baseDoc.title,
      content: result.content || baseDoc.content,
      updatedAt: new Date().toISOString(),
    };
    setActiveDoc(nextDoc);
    localStorage.setItem(storageKey(nextDoc.conversationId), JSON.stringify(nextDoc));
  };

  const callWriter = async (instruction: string, nextMode: WriterMode, doc?: WriterDoc | null, onDelta?: (delta: string, fullText: string) => void) => {
    const wordLimitMatch = instruction.match(/(\d+)\s*[\u5b57\u5b57\u7b26]/);
    const wordLimitHint = wordLimitMatch
      ? `【强制约束】用户明确要求字数限制为${wordLimitMatch[1]}字，你必须严格遵守，输出内容字数（不含空格）应尽量接近该限制，误差不超过10%。`
      : "请严格遵守用户要求的字数限制。如果用户指定了字数，输出内容字数（不含空格）必须尽量接近该限制，误差不超过10%。";

    const systemPrompt = nextMode === "writing"
      ? `你是 AI Space 的 AI写作助手。默认模型 ${WRITER_MODEL}。你负责生成、改写、润色和完善左侧文档。不要联网搜索。必须只按下面标签格式输出，不要 Markdown 代码块，不要额外解释：
<TITLE>
文档标题
</TITLE>
<CONTENT>
完整文档正文
</CONTENT>
<REPLY>
给用户的一句话说明
</REPLY>
如果用户要求修改，请基于现有文档输出修改后的完整标题和完整正文。${wordLimitHint}`
      : `你是 AI Space 的 AI写作助手。默认模型 ${WRITER_MODEL}。当前是聊天模式，只回答用户问题，不要改写左侧文档，不要联网搜索。`;

    const currentWordCount = doc ? countWords(doc.content || "") : 0;
    const context = doc
      ? `\n\n当前文档标题：${doc.title || "未命名文档"}\n当前文档正文字数（不含空格）：${currentWordCount}\n当前文档正文：\n${doc.content || "（空）"}`
      : "";

    const historyMessages = messages
      .filter((m) => m.content.trim() && !m.content.startsWith(t("writer.error.generateFailed")) && m.content !== t("writer.writingInProgress"))
      .slice(-10);

    const payload = {
      model: WRITER_MODEL,
      stream: true,
      search: false,
      reasoning: false,
      conversation_id: doc?.conversationId || activeDoc?.conversationId,
      messages: [
        { role: "system", content: systemPrompt + context },
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: instruction },
      ],
    };

    const res = await fetchWritingAssistantStream(payload);
    if (!res.ok) throw await readApiError(res);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !res.body) {
      const data = await res.json();
      return extractTextFromChatResponse(data);
    }

    let taskId: number | null = null;
    const conversationId = payload.conversation_id;
    const recoverFromTask = async () => {
      if (!taskId) return null;
      const taskRes = await apiFetch(`/tasks/${taskId}`);
      if (!taskRes.ok) return null;
      const data = await taskRes.json();
      const task = data?.task || {};
      const message = data?.message || {};
      const recovered = task.result || message.content || "";
      if ((task.status === "completed" || message.completed_at) && recovered) {
        return recovered;
      }
      if (["failed", "cancelled", "incomplete"].includes(task.status)) {
        throw normalizeError(task.error_message || t("writer.error.generate"), { module: "chat", fallbackMessage: t("writer.error.generate") });
      }
      return null;
    };

    const recoverFromConversation = async () => {
      if (!conversationId) return null;
      const res = await apiFetch(`/conversations/${conversationId}/messages`);
      if (!res.ok) return null;
      const data = await res.json();
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const latestAssistant = [...messages].reverse().find((msg: any) => msg?.role === "assistant" && msg?.content && msg?.completed_at);
      return latestAssistant?.content || null;
    };

    const recoverCompletedResult = async () => {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const recovered = await recoverFromTask() || await recoverFromConversation();
        if (recovered) return recovered;
        await sleep(800);
      }
      return null;
    };

    try {
      return await consumeChatStream(res, {
        onDelta: (delta, fullText) => onDelta?.(delta, fullText),
        onMeta: (meta) => {
          taskId = taskId || extractGenerationTaskId(meta);
        },
      });
    } catch (err) {
      const recovered = await recoverCompletedResult();
      if (recovered) return recovered;
      throw err;
    }
  };

  const openDocument = (conv: Conversation) => {
    flushPendingEditSnapshot();
    const saved = localStorage.getItem(storageKey(conv.id));
    const doc: WriterDoc = saved
      ? JSON.parse(saved)
      : {
          conversationId: conv.id,
          title: conv.title || t("writer.defaultTitle"),
          content: "",
          updatedAt: conv.updated_at || new Date().toISOString(),
        };
    const history = readDocHistory(conv.id);
    setActiveDoc(doc);
    replaceHistory(history.undo, history.redo, conv.id);
    const savedMessages = localStorage.getItem(messagesStorageKey(conv.id));
    setMessages(savedMessages ? JSON.parse(savedMessages) : []);
    setChatInput("");
    setHistoryOpen(false);
    setHistorySearch("");
  };

  const handleDeleteClick = (conv: Conversation) => {
    setDeleteTarget(conv);
  };

  const deleteDocument = async (conv: Conversation) => {
    try {
      const res = await apiFetch(`/conversations/${conv.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw await readApiError(res);
      }
      localStorage.removeItem(storageKey(conv.id));
      localStorage.removeItem(messagesStorageKey(conv.id));
      localStorage.removeItem(historyStorageKey(conv.id));
      setDocuments((prev) => prev.filter((item) => item.id !== conv.id));
      if (activeDoc?.conversationId === conv.id) {
        setActiveDoc(null);
        replaceHistory([], [], conv.id);
        setMessages([]);
      }
      toast.success(t("writer.success.deleted"));
    } catch (e) {
      showUserError(e, { module: "chat", fallbackTitle: t("writer.deleteFailed"), fallbackMessage: t("writer.deleteFailed") });
    } finally {
      setDeleteTarget(null);
    }
  };

  const confirmDeleteDocument = async () => {
    if (!deleteTarget) return;
    await deleteDocument(deleteTarget);
  };

  const handleHomeSubmit = async () => {
    const text = homeInput.trim();
    if (!text || isGenerating) return;
    setIsGenerating(true);
    setHomeInput("");
    const assistantId = `a-${Date.now()}`;
    const smoothKey = `home-${assistantId}`;
    try {
      const title = mode === "writing" ? (text.length > 24 ? `${text.slice(0, 24)}...` : text) : t("writer.defaultTitle");
      const conv = await createConversation(title);
      const doc: WriterDoc = { conversationId: conv.id, title, content: "", updatedAt: new Date().toISOString() };
      setDocuments((prev) => [conv, ...prev]);
      setActiveDoc(doc);
      replaceHistory([], [], conv.id);
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text, mode, createdAt: Date.now() };
      setMessages([userMsg]);

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: mode === "writing" ? t("writer.writingInProgress") : "", mode, createdAt: Date.now() }]);
      const appendDelta = mode === "chat"
        ? (_delta: string, fullText: string) => {
            enqueueSmoothText(smoothKey, fullText, (text) => {
              setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: text } : msg));
            });
          }
        : (_delta: string, fullText: string) => {
            enqueueSmoothText(smoothKey, fullText, (text) => applyWriterStream(doc, text));
          };

      if (mode === "writing") {
        recordUndoSnapshot({ title: doc.title, content: doc.content }, conv.id);
        const raw = await callWriter(text, "writing", doc, appendDelta);
        await drainSmoothText(smoothKey);
        const result = parseWriterResult(raw, t);
        finalizeWriterDoc(doc, { title: result.title || title, content: result.content || raw });
        setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: result.reply || t("writer.writingDone") } : msg));
      } else {
        await callWriter(text, "chat", doc, appendDelta);
        await drainSmoothText(smoothKey);
      }
      clearSmoothText(smoothKey);
      loadDocuments();
    } catch (e) {
      clearSmoothText(smoothKey);
      const userMessage = getErrorMessage(e, { module: "chat", fallbackMessage: t("writer.error.request") });
      toast.error(userMessage);
      setMessages((prev) => prev.map((msg) => msg.id === assistantId
        ? { ...msg, content: `${t("writer.error.generateFailed")}: ${userMessage}` }
        : msg
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleWorkspaceSubmit = async (submitMode: WriterMode = mode) => {
    const text = chatInput.trim();
    if (!text || !activeDoc || isGenerating) return;
    setChatInput("");
    setIsGenerating(true);
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text, mode: submitMode, createdAt: Date.now() };
    const assistantId = `a-${Date.now()}`;
    const smoothKey = `workspace-${assistantId}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", mode: submitMode, createdAt: Date.now() }]);
    const streamBaseDoc = activeDoc;
    const appendDelta = submitMode === "chat"
      ? (_delta: string, fullText: string) => {
          enqueueSmoothText(smoothKey, fullText, (text) => {
            setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: text } : msg));
          });
        }
      : (_delta: string, fullText: string) => {
          enqueueSmoothText(smoothKey, fullText, (text) => applyWriterStream(streamBaseDoc, text));
        };
    if (submitMode === "writing") {
      flushPendingEditSnapshot(activeDoc.conversationId);
      setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: t("writer.writingInProgress") } : msg));
    }
    try {
      const raw = await callWriter(text, submitMode, activeDoc, appendDelta);
      await drainSmoothText(smoothKey);
      if (submitMode === "writing") {
        const result = parseWriterResult(raw, t);
        const currentDoc = streamBaseDoc;
        recordUndoSnapshot({ title: currentDoc.title, content: currentDoc.content }, currentDoc.conversationId);
        finalizeWriterDoc(currentDoc, { title: result.title || currentDoc.title, content: result.content || raw });
        setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: result.reply || t("writer.writingDone") } : msg));
      }
      clearSmoothText(smoothKey);
      loadDocuments();
    } catch (e) {
      clearSmoothText(smoothKey);
      const userMessage = getErrorMessage(e, { module: "chat", fallbackMessage: t("writer.error.request") });
      toast.error(userMessage);
      setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: `${t("writer.error.generateFailed")}: ${userMessage}` } : msg));
    } finally {
      setIsGenerating(false);
    }
  };

  const exportDocx = async () => {
    if (!activeDoc) return;
    try {
      const paragraphs = activeDoc.content.split("\n").map((p) =>
        p.trim() ? new Paragraph({ children: [new TextRun(p)] }) : new Paragraph({ text: "" })
      );
      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              text: activeDoc.title || t("writer.defaultDocTitle"),
              heading: HeadingLevel.HEADING_1,
            }),
            ...paragraphs,
          ],
        }],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeDoc.title || t("writer.defaultDocTitle")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("writer.error.request"));
    }
  };

  if (!activeDoc) {
    return (
      <div className="flex h-full flex-col bg-surface-elevated text-text-primary">
        <div className="flex-1 overflow-auto px-6 py-12 md:px-10 md:py-20">
          <div className="mx-auto flex max-w-[800px] flex-col items-center gap-8">
            {/* 标题区域 */}
            <section className="flex flex-col items-center gap-3 text-center">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <FileText className="h-6 w-6" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl">{t("writer.title")}</h1>
              </div>
              <p className="text-sm text-text-secondary">{t("writer.subtitle")}</p>
            </section>

            {/* 输入框区域 */}
            <section className="relative w-full">
              <div className="relative min-h-[120px] w-full rounded-3xl border border-surface-border bg-surface p-5 shadow-sm">
                <textarea
                  value={homeInput}
                  onChange={(e) => setHomeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleHomeSubmit();
                    }
                  }}
                  placeholder={t("writer.placeholder.topic")}
                  className="min-h-[60px] w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
                />
                {/* 底部左侧：模式切换 */}
                <div className="absolute bottom-3 left-4 flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full bg-surface-card p-1">
                    <button
                      onClick={() => setMode("writing")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        mode === "writing"
                          ? "bg-surface-elevated text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <PenLine className="h-3.5 w-3.5" /> {t("writer.mode.write")}
                    </button>
                    <button
                      onClick={() => setMode("chat")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        mode === "chat"
                          ? "bg-surface-elevated text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> {t("writer.mode.chat")}
                    </button>
                  </div>
                  <button
                    onClick={() => toast.info(t("writer.webSearchUnavailable"))}
                    className="flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <Search className="h-3.5 w-3.5" /> {t("writer.mode.search")}
                  </button>
                </div>
                {/* 底部右侧：圆形生成按钮 */}
                <button
                  onClick={handleHomeSubmit}
                  disabled={!homeInput.trim() || isGenerating}
                  className={cn(
                    "absolute bottom-3 right-4 flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                    homeInput.trim() && !isGenerating
                      ? "bg-brand text-white hover:opacity-90"
                      : "bg-surface-border text-white"
                  )}
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                </button>
              </div>
            </section>

            {/* 快速提示词 */}
            <section className="w-full">
              <div className="flex flex-wrap justify-center gap-2">
                {quickPromptKeys.map((key) => t(key)).map((item) => (
                  <button
                    key={item}
                    onClick={() => setHomeInput(item)}
                    className="rounded-full border border-surface-border bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>

            {/* 文档区域 */}
            <section className="w-full pt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-text-primary">{t("writer.myDocuments")}</h2>
                <div className="flex items-center gap-2 rounded-full border border-surface-border bg-surface px-3 py-1.5 text-text-tertiary">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder={t("writer.placeholder.search")}
                    className="w-32 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary md:w-40"
                  />
                </div>
              </div>
              {loadingDocs ? (
                <div className="flex items-center justify-center rounded-2xl border border-surface-border bg-surface py-12 text-sm text-text-secondary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("writer.loadingHistory")}
                </div>
              ) : sortedDocuments.length === 0 ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <button
                    onClick={createBlankDoc}
                    className="group flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface p-5 text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand transition-transform group-hover:scale-110">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-3 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      {t("writer.startBlank")}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {/* 新建空白页卡片 */}
                  <button
                    onClick={createBlankDoc}
                    className="group flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface p-5 text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand transition-transform group-hover:scale-110">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-3 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      {t("writer.startBlank")}
                    </span>
                  </button>

                  {sortedDocuments.map((doc) => {
                    const localDoc = readStoredDoc(doc.id);
                    const displayTitle = localDoc?.title || doc.title || t("writer.defaultTitle");
                    const preview = localDoc?.content?.slice(0, 100) || "";
                    return (
                      <div
                        key={doc.id}
                        className="group relative flex h-[200px] flex-col rounded-2xl border border-surface-border bg-surface text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                      >
                        <button
                          onClick={() => openDocument(doc)}
                          className="flex min-h-0 flex-1 flex-col justify-between p-5 text-left"
                        >
                          <div className="min-w-0 text-left">
                            <h3 className="line-clamp-1 text-base font-medium text-text-primary">{displayTitle}</h3>
                            {preview ? (
                              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-text-secondary">{preview}</p>
                            ) : (
                              <p className="mt-2 text-sm text-text-tertiary">{t("writer.emptyContent")}</p>
                            )}
                          </div>
                          <span className="text-xs text-text-tertiary">{formatDate(doc.updated_at, t("time.justNow"))}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(doc);
                          }}
                          aria-label={t("writer.deleteAria").replace("{displayTitle}", displayTitle)}
                          className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        <ConfirmDialog
          isOpen={!!deleteTarget}
          title={t("writer.deleteConfirm.title")}
          description={deleteTarget ? t("writer.deleteConfirm").replace("{title}", getDocumentDisplayTitle(deleteTarget, t)) : ""}
          confirmText={t("writer.deleteConfirmBtn")}
          cancelText={t("common.cancel")}
          variant="danger"
          onConfirm={confirmDeleteDocument}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-elevated p-3 text-text-primary md:p-4">
      <header className="relative flex h-14 shrink-0 items-center justify-between rounded-t-2xl border-b border-surface-border bg-surface px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => setActiveDoc(null)} className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-card"
          >
            <span className="truncate text-sm font-semibold text-text-primary">{activeDoc.title || t("writer.defaultTitle")}</span>
            <HistoryIcon className={cn("h-4 w-4 shrink-0 transition-colors", historyOpen ? "text-brand" : "text-text-tertiary")} />
          </button>
        </div>
        <button onClick={exportDocx} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <Download className="h-4 w-4" /> {t("writer.exportDocx")}
        </button>

      </header>


      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("writer.myDocuments")}
        loading={loadingDocs}
        emptyText={t("writer.noHistory")}
        searchValue={historySearch}
        searchPlaceholder={t("writer.placeholder.search")}
        onSearchChange={setHistorySearch}
        items={filteredDocuments.map((doc): DrawerHistoryItem => ({
          id: doc.id,
          title: getDocumentDisplayTitle(doc, t),
          subtitle: formatDate(doc.updated_at),
          updated_at: doc.updated_at || new Date().toISOString(),
          active: activeDoc.conversationId === doc.id,
          icon: "file",
        }))}
        onSelect={(id) => {
          const doc = documents.find((item) => item.id === id);
          if (doc) openDocument(doc);
        }}
        deleteConfirmTitle={t("writer.deleteConfirm.title")}
        deleteConfirmDescription={(item) => t("writer.deleteConfirm").replace("{title}", item.title)}
        deleteConfirmText={t("writer.deleteConfirmBtn")}
        onDelete={(id) => {
          const doc = documents.find((item) => item.id === id);
          if (doc) void deleteDocument(doc);
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <section className="flex min-h-0 flex-1 flex-col rounded-b-2xl bg-surface shadow-sm md:rounded-br-none">
          <div className="shrink-0 px-8 pb-2 pt-8 md:px-12 md:pt-10">
            <input
              value={activeDoc.title === t("writer.defaultTitle") ? "" : activeDoc.title}
              onChange={(e) => updateActiveDoc({ title: e.target.value || t("writer.defaultTitle") })}
              className="w-full bg-transparent text-3xl font-semibold text-text-primary outline-none placeholder:text-text-tertiary md:text-4xl"
              placeholder={t("writer.defaultTitle")}
            />
          </div>
          <textarea
            value={activeDoc.content}
            onChange={(e) => updateActiveDoc({ content: e.target.value })}
            placeholder={t("writer.placeholder.content")}
            className="min-h-0 flex-1 resize-none bg-surface px-8 py-3 text-[15px] leading-8 text-text-primary outline-none placeholder:text-text-tertiary md:px-12"
          />
          <div className="flex h-12 shrink-0 items-center justify-center border-t border-surface-border bg-surface px-8 text-xs text-text-tertiary md:px-12">
            <div className="flex items-center gap-4 rounded-full bg-surface px-3 py-1.5">
              <button
                onClick={undoDoc}
                disabled={undoStack.length === 0}
                className="rounded-lg p-1 transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-tertiary disabled:opacity-40 disabled:hover:bg-transparent"
                title={t("writer.undo")}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                onClick={redoDoc}
                disabled={redoStack.length === 0}
                className="rounded-lg p-1 transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-tertiary disabled:opacity-40 disabled:hover:bg-transparent"
                title={t("writer.redo")}
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="h-4 w-px bg-surface-border" />
              <span>{t("writer.wordCount").replace("{count}", String(countWords(activeDoc.content)))}</span>
            </div>
          </div>
        </section>

        <div
          className="hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center md:flex"
          onPointerDown={handleAssistantResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("writer.resize")}
        >
          <div className="my-4 w-px rounded-full bg-surface-border transition-colors hover:bg-brand" />
        </div>

        <aside
          className="flex min-h-0 w-full flex-col rounded-2xl border border-surface-border bg-surface shadow-sm md:shrink-0"
          style={{ width: `min(100%, ${assistantWidth}px)` }}
        >
          <div className="shrink-0 border-b border-surface-border p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t("writer.sidebarTitle")}</h2>
              <button className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary">
                <Bot className="h-4 w-4" />
              </button>
            </div>
            <div className="flex rounded-full border border-surface-border bg-surface-elevated p-1">
              <button onClick={() => setMode("writing")} className={cn("flex-1 rounded-full px-3 py-1.5 text-sm transition-colors", mode === "writing" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}>
                <PenLine className="mr-1 inline h-3.5 w-3.5" /> {t("writer.sidebarWriting")}
              </button>
              <button onClick={() => setMode("chat")} className={cn("flex-1 rounded-full px-3 py-1.5 text-sm transition-colors", mode === "chat" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}>
                <MessageSquare className="mr-1 inline h-3.5 w-3.5" /> {t("writer.sidebarChat")}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-surface-border bg-surface p-4 text-sm text-text-secondary">
                {t("writer.placeholder.chat")}
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={cn("rounded-2xl px-4 py-3 text-sm leading-6", message.role === "user" ? "ml-8 bg-surface-card text-text-primary" : "mr-8 text-text-primary")}>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 p-4">
            {mode === "writing" && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface px-3 py-1.5 text-xs text-text-secondary">
                <PenLine className="h-3.5 w-3.5" /> {t("writer.generating")}
              </div>
            )}
            <div className="rounded-2xl border border-surface-border bg-surface px-3 py-2 shadow-sm">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleWorkspaceSubmit(mode);
                  }
                }}
                placeholder={t("writer.placeholder.chat")}
                className="min-h-16 w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <button onClick={() => setMode("writing")} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors", mode === "writing" ? "bg-surface-card text-text-primary" : "hover:bg-surface-card")}> 
                    <PenLine className="h-3.5 w-3.5" /> {t("writer.mode.write")}
                  </button>
                  <button onClick={() => setMode("chat")} className={cn("rounded-full px-2.5 py-1 transition-colors", mode === "chat" ? "bg-surface-card text-text-primary" : "hover:bg-surface-card")}>
                    {t("writer.mode.chat")}
                  </button>
                </div>
                <button onClick={() => handleWorkspaceSubmit(mode)} disabled={!chatInput.trim() || isGenerating} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={t("writer.deleteConfirm.title")}
        description={deleteTarget ? t("writer.deleteConfirm").replace("{title}", getDocumentDisplayTitle(deleteTarget, t)) : ""}
        confirmText={t("writer.deleteConfirmBtn")}
        cancelText={t("common.cancel")}
        variant="danger"
        onConfirm={confirmDeleteDocument}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
