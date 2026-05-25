"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Plus,
  Search,
  Send,
  Sparkles,
  Undo2,
  Redo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

const quickPrompts = ["写一篇产品发布稿", "帮我起草商业计划书", "写一篇小红书种草文", "把这段内容润色成高级表达"];

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

function getDocumentDisplayTitle(doc: Conversation) {
  return readStoredDoc(doc.id)?.title || doc.title || "未命名";
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

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function extractTextFromChatResponse(data: any): string {
  const choice = data?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || data?.message?.content || data?.content || "";
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function parseWriterResult(raw: string): { reply: string; title?: string; content?: string } {
  const cleaned = stripJsonFence(raw);
  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: parsed.reply || "已完成写作处理。",
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
      reply: "已生成内容，并同步到左侧文档。",
      title,
      content,
    };
  }
}

function formatDate(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function WritingAssistantPage() {
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
  const [undoStack, setUndoStack] = useState<DocSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocSnapshot[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditSnapshotRef = useRef<DocSnapshot | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const typewriteDoc = (baseDoc: WriterDoc, targetTitle: string, targetContent: string) => {
    return new Promise<void>((resolve) => {
      let titleIdx = 0;
      let contentIdx = 0;
      let phase: "title" | "content" = "title";

      const tick = () => {
        if (phase === "title") {
          titleIdx = Math.min(titleIdx + 2, targetTitle.length);
          setActiveDoc({ ...baseDoc, title: targetTitle.slice(0, titleIdx), content: baseDoc.content });
          if (titleIdx >= targetTitle.length) {
            phase = "content";
          }
          setTimeout(tick, 28);
        } else {
          contentIdx = Math.min(contentIdx + 8, targetContent.length);
          setActiveDoc({ ...baseDoc, title: targetTitle, content: targetContent.slice(0, contentIdx) });
          if (contentIdx >= targetContent.length) {
            resolve();
            return;
          }
          setTimeout(tick, 14);
        }
      };
      tick();
    });
  };

  const sortedDocuments = useMemo(
    () => documents.filter((item) => item.skill_key === WRITER_SKILL_KEY).sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()),
    [documents]
  );

  const filteredDocuments = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) return sortedDocuments;
    return sortedDocuments.filter((item) => getDocumentDisplayTitle(item).toLowerCase().includes(keyword));
  }, [historySearch, sortedDocuments]);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch("/api/conversations?limit=200", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("获取历史失败");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.conversations || [];
      setDocuments(list);
    } catch (e: any) {
      toast.error(e.message || "获取历史失败");
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
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title: title || "AI写作助手", model: WRITER_MODEL, skill_key: WRITER_SKILL_KEY }),
    });
    if (!res.ok) throw new Error("创建写作文档失败");
    return (await res.json()) as Conversation;
  };

  const createBlankDoc = async () => {
    try {
      const conv = await createConversation("未命名");
      const doc: WriterDoc = { conversationId: conv.id, title: "未命名", content: "", updatedAt: new Date().toISOString() };
      localStorage.setItem(storageKey(conv.id), JSON.stringify(doc));
      writeDocHistory(conv.id, [], []);
      setDocuments((prev) => [conv, ...prev]);
      setActiveDoc(doc);
      replaceHistory([], [], conv.id);
      setMessages([]);
      setChatInput("");
    } catch (e: any) {
      toast.error(e.message || "创建空白文档失败");
    }
  };

  const callWriter = async (instruction: string, nextMode: WriterMode, doc?: WriterDoc | null, onDelta?: (delta: string) => void) => {
    const wordLimitMatch = instruction.match(/(\d+)\s*[\u5b57\u5b57\u7b26]/);
    const wordLimitHint = wordLimitMatch
      ? `【强制约束】用户明确要求字数限制为${wordLimitMatch[1]}字，你必须严格遵守，输出内容字数（不含空格）应尽量接近该限制，误差不超过10%。`
      : "请严格遵守用户要求的字数限制。如果用户指定了字数，输出内容字数（不含空格）必须尽量接近该限制，误差不超过10%。";

    const systemPrompt = nextMode === "writing"
      ? `你是 AI Space 的 AI写作助手。默认模型 ${WRITER_MODEL}。你负责生成、改写、润色和完善左侧文档。不要联网搜索。请只返回 JSON，不要 Markdown 代码块。格式：{"reply":"给用户的一句话说明","title":"文档标题","content":"完整文档正文"}。如果用户要求修改，请基于现有文档输出修改后的完整标题和完整正文。${wordLimitHint}`
      : `你是 AI Space 的 AI写作助手。默认模型 ${WRITER_MODEL}。当前是聊天模式，只回答用户问题，不要改写左侧文档，不要联网搜索。`;

    const currentWordCount = doc ? countWords(doc.content || "") : 0;
    const context = doc
      ? `\n\n当前文档标题：${doc.title || "未命名文档"}\n当前文档正文字数（不含空格）：${currentWordCount}\n当前文档正文：\n${doc.content || "（空）"}`
      : "";

    const historyMessages = messages
      .filter((m) => m.content.trim() && !m.content.startsWith("生成失败：") && m.content !== "正在写入左侧文档...")
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

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || "生成失败");
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !res.body) {
      const data = await res.json();
      return extractTextFromChatResponse(data);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    const handleEvent = (event: string) => {
      const lines = event.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed._error_meta?.user_message) {
            throw new Error(parsed._error_meta.user_message);
          }
          const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || "";
          if (delta) {
            fullText += delta;
            onDelta?.(delta);
          }
        } catch (err) {
          if (err instanceof Error) throw err;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleEvent(event);
        idx = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) handleEvent(buffer);

    return fullText.trim();
  };

  const openDocument = (conv: Conversation) => {
    flushPendingEditSnapshot();
    const saved = localStorage.getItem(storageKey(conv.id));
    const doc: WriterDoc = saved
      ? JSON.parse(saved)
      : {
          conversationId: conv.id,
          title: conv.title || "未命名",
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

  const handleHomeSubmit = async () => {
    const text = homeInput.trim();
    if (!text || isGenerating) return;
    setIsGenerating(true);
    setHomeInput("");
    const assistantId = `a-${Date.now()}`;
    try {
      const title = mode === "writing" ? (text.length > 24 ? `${text.slice(0, 24)}...` : text) : "未命名";
      const conv = await createConversation(title);
      const doc: WriterDoc = { conversationId: conv.id, title, content: "", updatedAt: new Date().toISOString() };
      setDocuments((prev) => [conv, ...prev]);
      setActiveDoc(doc);
      replaceHistory([], [], conv.id);
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text, mode, createdAt: Date.now() };
      setMessages([userMsg]);

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: mode === "writing" ? "正在写入左侧文档..." : "", mode, createdAt: Date.now() }]);
      const appendDelta = mode === "chat"
        ? (delta: string) => {
            setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg));
          }
        : undefined;

      if (mode === "writing") {
        const raw = await callWriter(text, "writing", doc, appendDelta);
        const result = parseWriterResult(raw);
        recordUndoSnapshot({ title: doc.title, content: doc.content }, conv.id);
        await typewriteDoc(
          { conversationId: conv.id, title: "", content: "", updatedAt: new Date().toISOString() },
          result.title || title,
          result.content || raw
        );
        setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: result.reply || "已完成写作，并同步到左侧文档。" } : msg));
      } else {
        await callWriter(text, "chat", doc, appendDelta);
      }
      loadDocuments();
    } catch (e: any) {
      toast.error(e.message || "请求失败");
      setMessages((prev) => prev.map((msg) => msg.id === assistantId
        ? { ...msg, content: `生成失败：${e.message || "请求失败"}` }
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
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", mode: submitMode, createdAt: Date.now() }]);
    const appendDelta = submitMode === "chat"
      ? (delta: string) => {
          setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg));
        }
      : undefined;
    if (submitMode === "writing") {
      flushPendingEditSnapshot(activeDoc.conversationId);
      setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: "正在写入左侧文档..." } : msg));
    }
    try {
      const raw = await callWriter(text, submitMode, activeDoc, appendDelta);
      if (submitMode === "writing") {
        const result = parseWriterResult(raw);
        const currentDoc = activeDoc;
        recordUndoSnapshot({ title: currentDoc.title, content: currentDoc.content }, currentDoc.conversationId);
        await typewriteDoc(
          { ...currentDoc, title: "", content: "", updatedAt: new Date().toISOString() },
          result.title || currentDoc.title,
          result.content || raw
        );
        setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: result.reply || "已完成写作，并同步到左侧文档。" } : msg));
      }
      loadDocuments();
    } catch (e: any) {
      toast.error(e.message || "请求失败");
      setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: `生成失败：${e.message || "请求失败"}` } : msg));
    } finally {
      setIsGenerating(false);
    }
  };

  const exportDocx = () => {
    if (!activeDoc) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${activeDoc.title}</title></head><body><h1>${activeDoc.title}</h1>${activeDoc.content.split("\n").map((p) => `<p>${p || "&nbsp;"}</p>`).join("")}</body></html>`;
    const blob = new Blob([html], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDoc.title || "AI写作文档"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeDoc) {
    return (
      <div className="flex h-full flex-col bg-white text-text-primary">
        <div className="flex-1 overflow-auto px-6 py-12 md:px-10 md:py-20">
          <div className="mx-auto flex max-w-[800px] flex-col items-center gap-8">
            {/* 标题区域 */}
            <section className="flex flex-col items-center gap-3 text-center">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <FileText className="h-6 w-6" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl">AI写作助手</h1>
              </div>
              <p className="text-sm text-text-secondary">AI帮助您理清思路，撰写优质内容</p>
            </section>

            {/* 输入框区域 */}
            <section className="relative w-full">
              <div className="relative min-h-[120px] w-full rounded-3xl border border-surface-border bg-white p-5 shadow-sm">
                <textarea
                  value={homeInput}
                  onChange={(e) => setHomeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleHomeSubmit();
                    }
                  }}
                  placeholder="输入一个主题开始写作"
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
                          ? "bg-white text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <PenLine className="h-3.5 w-3.5" /> 写作
                    </button>
                    <button
                      onClick={() => setMode("chat")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        mode === "chat"
                          ? "bg-white text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> 聊天
                    </button>
                  </div>
                  <button
                    onClick={() => toast.info("联网搜索暂未开启")}
                    className="flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <Search className="h-3.5 w-3.5" /> 搜索
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
                {quickPrompts.map((item) => (
                  <button
                    key={item}
                    onClick={() => setHomeInput(item)}
                    className="rounded-full border border-surface-border bg-white px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-card hover:text-text-primary"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>

            {/* 文档区域 */}
            <section className="w-full pt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-text-primary">我创建的文档</h2>
                <div className="flex items-center gap-2 rounded-full border border-surface-border bg-white px-3 py-1.5 text-text-tertiary">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="搜索"
                    className="w-32 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary md:w-40"
                  />
                </div>
              </div>
              {loadingDocs ? (
                <div className="flex items-center justify-center rounded-2xl border border-surface-border bg-surface py-12 text-sm text-text-secondary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载历史中...
                </div>
              ) : sortedDocuments.length === 0 ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <button
                    onClick={createBlankDoc}
                    className="group flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-white p-5 text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand transition-transform group-hover:scale-110">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-3 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      从空白页开始
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {/* 新建空白页卡片 */}
                  <button
                    onClick={createBlankDoc}
                    className="group flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-white p-5 text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand transition-transform group-hover:scale-110">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-3 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                      从空白页开始
                    </span>
                  </button>

                  {sortedDocuments.map((doc) => {
                    const localDoc = readStoredDoc(doc.id);
                    const displayTitle = localDoc?.title || doc.title || "未命名";
                    const preview = localDoc?.content?.slice(0, 100) || "";
                    return (
                      <button
                        key={doc.id}
                        onClick={() => openDocument(doc)}
                        className="group relative flex h-[200px] flex-col justify-between rounded-2xl border border-surface-border bg-white p-5 text-left shadow-sm transition-all hover:border-brand/40 hover:bg-surface-card hover:shadow-md"
                      >
                        <div className="min-w-0 text-left">
                          <h3 className="line-clamp-1 text-base font-medium text-text-primary">{displayTitle}</h3>
                          {preview ? (
                            <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-text-secondary">{preview}</p>
                          ) : (
                            <p className="mt-2 text-sm text-text-tertiary">暂无内容</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-tertiary">{formatDate(doc.updated_at)}</span>
                          <span className="text-lg text-text-secondary opacity-0 transition-opacity group-hover:opacity-100">
                            ...
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
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
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-card"
          >
            <span className="truncate text-sm font-semibold text-text-primary">{activeDoc.title || "未命名"}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", historyOpen && "rotate-180")} />
          </button>
        </div>
        <button onClick={exportDocx} className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <Download className="h-4 w-4" /> 导出 DOCX
        </button>

        {historyOpen && (
          <div className="absolute left-4 top-12 z-30 w-[320px] rounded-2xl border border-surface-border bg-surface p-3 shadow-xl md:left-6">
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-3 py-2 text-text-tertiary">
              <Search className="h-4 w-4" />
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="搜索"
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {filteredDocuments.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-text-tertiary">暂无写作历史</div>
              ) : (
                <div className="space-y-1">
                  {filteredDocuments.map((doc) => {
                    const selected = doc.id === activeDoc.conversationId;
                    const displayTitle = getDocumentDisplayTitle(doc);
                    return (
                      <button
                        key={doc.id}
                        onClick={() => openDocument(doc)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-brand/10",
                          selected && "bg-brand/10"
                        )}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                          <FileText className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-primary">{displayTitle}</span>
                          <span className="mt-1 block text-xs text-text-tertiary">{formatDate(doc.updated_at)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <section className="flex min-h-0 flex-1 flex-col rounded-b-2xl bg-surface shadow-sm md:rounded-br-none">
          <div className="shrink-0 px-8 pb-2 pt-8 md:px-12 md:pt-10">
            <input
              value={activeDoc.title === "未命名" ? "" : activeDoc.title}
              onChange={(e) => updateActiveDoc({ title: e.target.value || "未命名" })}
              className="w-full bg-transparent text-3xl font-semibold text-text-primary outline-none placeholder:text-text-tertiary md:text-4xl"
              placeholder="未命名"
            />
          </div>
          <textarea
            value={activeDoc.content}
            onChange={(e) => updateActiveDoc({ content: e.target.value })}
            placeholder="写点什么..."
            className="min-h-0 flex-1 resize-none bg-surface px-8 py-3 text-[15px] leading-8 text-text-primary outline-none placeholder:text-text-tertiary md:px-12"
          />
          <div className="flex h-12 shrink-0 items-center justify-center border-t border-surface-border bg-surface px-8 text-xs text-text-tertiary md:px-12">
            <div className="flex items-center gap-4 rounded-full bg-surface px-3 py-1.5">
              <button
                onClick={undoDoc}
                disabled={undoStack.length === 0}
                className="rounded-lg p-1 transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-tertiary disabled:opacity-40 disabled:hover:bg-transparent"
                title="撤回"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                onClick={redoDoc}
                disabled={redoStack.length === 0}
                className="rounded-lg p-1 transition-colors hover:bg-surface-card hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-tertiary disabled:opacity-40 disabled:hover:bg-transparent"
                title="恢复"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="h-4 w-px bg-surface-border" />
              <span>{countWords(activeDoc.content)} 字</span>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 w-full flex-col rounded-2xl border border-surface-border bg-surface shadow-sm md:w-[420px]">
          <div className="shrink-0 border-b border-surface-border p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">写作助手</h2>
              <button className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-surface-card hover:text-text-primary">
                <Bot className="h-4 w-4" />
              </button>
            </div>
            <div className="flex rounded-full border border-surface-border bg-surface-elevated p-1">
              <button onClick={() => setMode("writing")} className={cn("flex-1 rounded-full px-3 py-1.5 text-sm transition-colors", mode === "writing" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}>
                <PenLine className="mr-1 inline h-3.5 w-3.5" /> 写作
              </button>
              <button onClick={() => setMode("chat")} className={cn("flex-1 rounded-full px-3 py-1.5 text-sm transition-colors", mode === "chat" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}>
                <MessageSquare className="mr-1 inline h-3.5 w-3.5" /> 聊天
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-surface-border bg-surface p-4 text-sm text-text-secondary">
                告诉我你想怎么改：扩写、润色、改结尾、提炼标题，或直接聊写作思路。
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
                <PenLine className="h-3.5 w-3.5" /> 正在写作...
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
                placeholder="输入消息..."
                className="min-h-16 w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <button onClick={() => setMode("writing")} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors", mode === "writing" ? "bg-surface-card text-text-primary" : "hover:bg-surface-card")}> 
                    <PenLine className="h-3.5 w-3.5" /> 写作
                  </button>
                  <button onClick={() => setMode("chat")} className={cn("rounded-full px-2.5 py-1 transition-colors", mode === "chat" ? "bg-surface-card text-text-primary" : "hover:bg-surface-card")}>
                    聊天
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
    </div>
  );
}
