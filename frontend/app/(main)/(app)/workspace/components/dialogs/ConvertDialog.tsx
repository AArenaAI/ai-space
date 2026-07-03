"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, FileText, X, Trash2, MessageSquareText, Sparkles } from "lucide-react";
import DialogShell, { THEMES } from "./DialogShell";
import { getErrorMessage, readApiError, showUserError } from "@/lib/errors";
import { getClipboardFiles } from "@/lib/clipboardFiles";
import { apiFetch, apiJson } from "@/lib/api/client";

interface Msg {
  role: "user" | "assistant";
  content: string;
  files?: { name: string; id: number }[];
}

export default function ConvertDialog({ open, onClose, workspaceId, modelId }: { open: boolean; onClose: () => void; workspaceId: number; modelId?: string }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "你好！我是文件转换坊助手。可以上传文件让我摘要、转换格式或提取关键信息。" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<{ id: number; name: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const theme = THEMES.teal;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text && uploadedFiles.length === 0) return;

    const userMsg: Msg = { role: "user", content: text, files: uploadedFiles.length > 0 ? uploadedFiles : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setUploadedFiles([]);
    setLoading(true);

    try {
      const conv = await apiJson<{ id: number }>("/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "文件转换", workspace_id: workspaceId }),
      });

      const body: any = { content: text, conversation_id: conv.id };
      if (modelId) body.model = modelId;
      if (uploadedFiles.length > 0) body.file_ids = uploadedFiles.map((f) => f.id);

      const reply = await apiJson<any>("/conversations/messages", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: reply.content || "已处理完成" }]);
    } catch (e) {
      const userMessage = getErrorMessage(e, { module: "chat", fallbackMessage: "发送失败，请稍后重试。" });
      setMessages((prev) => [...prev, { role: "assistant", content: `错误：${userMessage}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || !workspaceId) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("workspace_id", String(workspaceId));
      try {
        const res = await apiFetch("/files/upload", {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();
        setUploadedFiles((prev) => [...prev, { id: data.id, name: data.original_name }]);
      } catch (err) {
        showUserError(err, {
          module: "file",
          fallbackTitle: "上传失败",
          fallbackMessage: `${file.name} 上传失败，请重新选择文件。`,
        });
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = getClipboardFiles(e);
    if (pastedFiles.length === 0) return;
    e.preventDefault();
    handleFileUpload(pastedFiles);
  };

  return (
    <DialogShell open={open} onClose={onClose} title="文件转换坊" icon={<MessageSquareText className={`h-4 w-4 ${theme.primary}`} />} size="lg" theme={theme}>
      {/* 青色氛围提示 */}
      <div className={`mb-3 flex items-center gap-3 rounded-xl ${theme.primaryBg} ${theme.primaryBorder} border px-4 py-2.5`}>
        <Sparkles className={`h-4 w-4 ${theme.primary}`} />
        <p className="text-[11px] text-text-secondary">上传文件，描述你想要的转换方式，AI 将为你处理</p>
      </div>

      <div className="flex h-[460px] flex-col">
        {/* 消息区域 */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-hide">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.role === "assistant" ? `${theme.primaryBg} ${theme.primaryBorder} border` : "bg-surface-card border border-surface-border"}`}>
                {m.role === "assistant" ? <Bot className={`h-3.5 w-3.5 ${theme.primary}`} /> : <User className="h-3.5 w-3.5 text-text-secondary" />}
              </div>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.role === "assistant" ? "bg-surface-card border border-surface-border text-text-primary" : `${theme.accent} text-white`}`}>
                {m.files && m.files.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {m.files.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1 rounded-md bg-black/10 px-1.5 py-0.5 text-[10px]">
                        <FileText className="h-3 w-3" />{f.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full ${theme.primaryBg} ${theme.primaryBorder} border`}>
                <Bot className={`h-3.5 w-3.5 ${theme.primary}`} />
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* 输入区 - 青色主题 */}
        <div className="mt-3 rounded-xl border border-surface-border bg-surface-card p-2">
          {uploadedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {uploadedFiles.map((f) => (
                <span key={f.id} className={`inline-flex items-center gap-1 rounded-lg border ${theme.primaryBorder} ${theme.primaryBg} px-2 py-1 text-[11px] text-text-secondary`}>
                  <FileText className={`h-3 w-3 ${theme.primary}`} />{f.name}
                  <button onClick={() => setUploadedFiles((prev) => prev.filter((x) => x.id !== f.id))} className="text-text-tertiary hover:text-red-400">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button onClick={() => fileInputRef.current?.click()} className={`shrink-0 rounded-lg border border-surface-border bg-surface-elevated p-2 text-text-tertiary hover:${theme.primary} transition-colors`}>
              <FileText className="h-4 w-4" />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="请描述你想对文件做什么..."
              className="h-10 max-h-24 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <button
              onClick={handleSend}
              disabled={loading || (!input.trim() && uploadedFiles.length === 0)}
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg ${theme.accent} text-white hover:opacity-90 disabled:opacity-40 transition-opacity`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
