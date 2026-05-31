"use client";
import { getErrorMessage, readApiError } from "@/lib/errors";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Bot, Check, ChevronDown, FileArchive, FileText,
  FolderKanban, FolderOpen, Image, MessageSquare,
  Pencil, Plus, RefreshCw, Send, Sparkles, Trash2,
  Layers, HelpCircle, GitBranch, BarChart3, X, User,
} from "lucide-react";
import ModelSelector from "@/components/chat/ModelSelector";
import { useModels } from "@/hooks/useModels";
import { useWorkspaces, Workspace } from "@/hooks/useWorkspaces";
import VoxelCanvas from "./components/VoxelCanvas";
import UploadDialog from "./components/dialogs/UploadDialog";
import StudyDialog from "./components/dialogs/StudyDialog";
import ConvertDialog from "./components/dialogs/ConvertDialog";
import ImageGenDialog from "./components/dialogs/ImageGenDialog";
import ImageEditDialog from "./components/dialogs/ImageEditDialog";
import ToolsDialog from "./components/dialogs/ToolsDialog";

interface FileItem {
  id: number;
  public_id: string;
  original_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export default function WorkspacePage() {
  const { models } = useModels();
  const {
    workspaces, currentWS, loading,
    switchWorkspace, createWorkspace, deleteWorkspace, renameWorkspace, refresh,
  } = useWorkspaces();

  const [activeWS, setActiveWS] = useState<Workspace | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(models[0]);
  const [activeToolTab, setActiveToolTab] = useState<"flashcard" | "quiz" | "graph" | "infographic">("flashcard");
  const [activeDialog, setActiveDialog] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === selectedModel?.id)) {
      setSelectedModel(models[0]);
    }
  }, [models, selectedModel?.id]);

  useEffect(() => {
    if (currentWS && currentWS.id !== activeWS?.id) {
      setActiveWS(currentWS);
    }
  }, [currentWS, activeWS?.id]);

  const loadWorkspaceData = useCallback(async (wsId: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const [convRes, fileRes] = await Promise.all([
        fetch(`/api/conversations?workspace_id=${wsId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/files?workspace_id=${wsId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (convRes.ok) { const data = await convRes.json(); setConversations(Array.isArray(data) ? data : []); }
      if (fileRes.ok) { const data = await fileRes.json(); setFiles(Array.isArray(data) ? data : []); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeWS) loadWorkspaceData(activeWS.id);
  }, [activeWS, loadWorkspaceData]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const ws = await createWorkspace(newName.trim());
    if (ws) { switchWorkspace(ws); setActiveWS(ws); setCreating(false); setNewName(""); }
  };

  const handleRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    const ok = await renameWorkspace(renaming.id, renaming.name.trim());
    if (ok) setRenaming(null);
  };

  const handleDelete = async (id: number) => {
    const ok = await deleteWorkspace(id);
    if (ok) {
      setShowDeleteConfirm(null);
      const next = workspaces.find((w) => w.id !== id);
      if (next) { setActiveWS(next); switchWorkspace(next); }
    }
  };

  const handleSwitch = (ws: Workspace) => { switchWorkspace(ws); setActiveWS(ws); };

  const handleChatSubmit = async () => {
    const query = chatInput.trim();
    if (!query || chatLoading || !activeWS) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const token = localStorage.getItem("token");
      // 创建临时对话
      const convRes = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: query.slice(0, 30), workspace_id: activeWS.id }),
      });
      if (!convRes.ok) throw await readApiError(convRes);
      const conv = await convRes.json();

      // 发送消息
      const body: any = { content: query, conversation_id: conv.id };
      if (selectedModel?.id) body.model = selectedModel.id;

      const msgRes = await fetch("/api/conversations/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!msgRes.ok) {
        throw await readApiError(msgRes);
      }
      const reply = await msgRes.json();
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply.content || "已完成" }]);
    } catch (e) {
      const userMessage = getErrorMessage(e, { module: "chat", fallbackMessage: "发送失败，请稍后重试。" });
      setChatMessages((prev) => [...prev, { role: "assistant", content: `错误：${userMessage}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const currentName = activeWS?.name || "workspace空间";
  const fileCount = files.length;
  const convCount = conversations.length;
  const recentFiles = useMemo(() => files.slice(0, 3), [files]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-surface text-text-primary">
      {/* 顶部栏 */}
      <header className="relative z-20 flex h-14 items-center justify-between border-b border-surface-border/70 bg-surface/75 px-5 backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/20 bg-brand/10">
            <FolderKanban className="h-[18px] w-[18px] text-brand" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-text-primary">{currentName}</h1>
              {activeWS?.is_default && (
                <span className="rounded-full border border-surface-border bg-surface-card px-2 py-0.5 text-[10px] text-text-tertiary">默认</span>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary">AI Voxel 空间世界</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="hidden items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary sm:flex">
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90">
            <Plus className="h-3.5 w-3.5" />
            新建空间
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="relative z-10 h-[calc(100%-3.5rem)] overflow-y-auto scrollbar-hide">
        <div className="grid min-h-full grid-cols-1 gap-4 p-4 pb-40 lg:grid-cols-[1fr_280px] lg:p-5 lg:pb-32">

          {/* ═════ 中央 Voxel 世界 ═════ */}
          <section className="relative min-h-[560px] overflow-hidden rounded-[32px] border border-surface-border shadow-2xl shadow-black/5">
            {/* 左上方标题 */}
            <div className="pointer-events-none absolute left-6 top-6 z-10 max-w-[320px]">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs text-text-secondary">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                AI Space World
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary md:text-3xl">你的 Voxel 小世界</h2>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                每座小房子都是一种空间能力。拖拽旋转、滚轮缩放、点击进入。
              </p>
            </div>

            {/* 右上方统计 */}
            <div className="pointer-events-none absolute right-6 top-6 z-10 grid grid-cols-3 gap-2 rounded-2xl border border-surface-border bg-surface/75 p-2 backdrop-blur-xl">
              <StatItem label="空间" value={workspaces.length} />
              <StatItem label="文件" value={fileCount} />
              <StatItem label="对话" value={convCount} />
            </div>

            {/* WebGL 3D 场景 */}
            <VoxelCanvas onHouseClick={(key) => setActiveDialog(key)} />
          </section>

          {/* ═════ 右侧面板 ═════ */}
          <aside className="flex flex-col gap-3 h-full overflow-y-auto scrollbar-hide">
            {/* 空间列表 */}
            <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">空间列表</h3>
                  <p className="text-[11px] text-text-tertiary">切换不同 workspace</p>
                </div>
                <button onClick={() => setCreating(true)} className="rounded-xl border border-surface-border bg-surface-card p-2 text-text-secondary hover:text-text-primary" title="新建空间">
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {workspaces.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <FolderOpen className="h-8 w-8 text-text-tertiary" />
                  <p className="text-sm text-text-secondary">还没有 workspace空间</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {workspaces.map((ws) => {
                    const active = ws.id === activeWS?.id;
                    return (
                      <div key={ws.id} className={cn("group relative rounded-xl border p-2.5 transition-colors", active ? "border-surface-border bg-surface-card shadow-sm" : "border-surface-border bg-surface-card hover:border-text-tertiary/40")}>
                        {renaming?.id === ws.id ? (
                          <div className="flex items-center gap-1">
                            <input className="min-w-0 flex-1 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                              value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(null); }} autoFocus />
                            <button onClick={handleRename} className="rounded-lg p-1.5 text-brand hover:bg-surface-elevated"><Check className="h-4 w-4" /></button>
                          </div>
                        ) : (
                          <button onClick={() => handleSwitch(ws)} className="flex w-full items-center gap-3 text-left">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface-elevated">
                              <FolderKanban className={cn("h-3.5 w-3.5", active ? "text-text-primary" : "text-text-tertiary")} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text-primary">{ws.name}</p>
                              <p className="text-[11px] text-text-tertiary">{ws.is_default ? "默认空间" : "自定义空间"}</p>
                            </div>
                            <ChevronDown className={cn("h-4 w-4 -rotate-90 text-text-tertiary", active && "text-text-primary")} />
                          </button>
                        )}

                        {!ws.is_default && !renaming && (
                          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => setRenaming({ id: ws.id, name: ws.name })} className="rounded-md bg-surface p-1 text-text-tertiary hover:text-text-primary"><Pencil className="h-3 w-3" /></button>
                            <button onClick={() => setShowDeleteConfirm(ws.id)} className="rounded-md bg-surface p-1 text-text-tertiary hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}

                        {showDeleteConfirm === ws.id && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface-elevated/95 p-3 text-center backdrop-blur-sm">
                            <p className="text-sm font-medium text-text-primary">删除「{ws.name}」？</p>
                            <div className="flex gap-2">
                              <button onClick={() => handleDelete(ws.id)} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white">删除</button>
                              <button onClick={() => setShowDeleteConfirm(null)} className="rounded-lg bg-surface-card px-3 py-1.5 text-xs text-text-secondary">取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 最近文件 */}
            <div className="rounded-2xl border border-surface-border bg-surface-elevated p-4">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">最近文件</h3>
              {recentFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-surface-border bg-surface-card p-4 text-center text-xs text-text-tertiary">当前空间还没有文件</div>
              ) : (
                <div className="space-y-2">
                  {recentFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-brand" />
                      <span className="truncate text-xs text-text-secondary">{file.original_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 学习工具 */}
            <div className="flex-1 rounded-2xl border border-surface-border bg-surface-elevated p-4 overflow-hidden flex flex-col min-h-[220px]">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">学习工具</h3>
              <div className="mb-3 flex gap-0.5 rounded-xl bg-surface-card p-1">
                {[
                  { key: "flashcard" as const, label: "闪卡", icon: Layers },
                  { key: "quiz" as const, label: "测验", icon: HelpCircle },
                  { key: "graph" as const, label: "知识图谱", icon: GitBranch },
                  { key: "infographic" as const, label: "信息图", icon: BarChart3 },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveToolTab(tab.key)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-all",
                      activeToolTab === tab.key
                        ? "bg-surface-elevated text-text-primary shadow-sm"
                        : "text-text-tertiary hover:text-text-secondary"
                    )}
                    title={tab.label}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                {activeToolTab === "flashcard" && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-border bg-surface-card">
                      <Layers className="h-6 w-6 text-text-tertiary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-secondary">暂无闪卡</p>
                      <p className="text-[11px] leading-4 text-text-tertiary">上传文件后，AI 可自动生成记忆闪卡<br />帮助快速复习核心知识点</p>
                    </div>
                  </div>
                )}
                {activeToolTab === "quiz" && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-border bg-surface-card">
                      <HelpCircle className="h-6 w-6 text-text-tertiary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-secondary">暂无测验</p>
                      <p className="text-[11px] leading-4 text-text-tertiary">AI 可从文件中提取重点<br />生成选择题与问答题</p>
                    </div>
                  </div>
                )}
                {activeToolTab === "graph" && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-border bg-surface-card">
                      <GitBranch className="h-6 w-6 text-text-tertiary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-secondary">暂无知识图谱</p>
                      <p className="text-[11px] leading-4 text-text-tertiary">AI 可分析文件内容<br />构建概念关联网络图谱</p>
                    </div>
                  </div>
                )}
                {activeToolTab === "infographic" && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-border bg-surface-card">
                      <BarChart3 className="h-6 w-6 text-text-tertiary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-secondary">暂无信息图</p>
                      <p className="text-[11px] leading-4 text-text-tertiary">将文件数据与概念<br />一键转译为可视化信息图</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Link href="/chat" className="flex items-center justify-between rounded-2xl border border-brand/25 bg-brand/10 p-4 text-sm font-medium text-brand transition-colors hover:bg-brand/15">
              进入当前空间聊天
              <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      </main>

      {/* ═════ 左下角 AI 聊天模块 ═════ */}
      <div className="fixed bottom-4 left-4 z-30 w-[min(340px,calc(100vw-32px))] md:left-20">
        {chatOpen ? (
          <div className="rounded-2xl border border-surface-border bg-surface-elevated/95 p-3 shadow-2xl backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10">
                  <Bot className="h-4 w-4 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">AI 空间助手</p>
                  <p className="text-[11px] text-text-tertiary">当前：{currentName}</p>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="rounded-lg p-1 text-text-tertiary hover:bg-surface-card hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedModel && (
              <div className="mb-2">
                <ModelSelector models={models as any} selected={selectedModel as any} onSelect={(m) => setSelectedModel(m as any)} />
              </div>
            )}

            {/* 消息列表 */}
            <div className="mb-2 max-h-[200px] space-y-2 overflow-y-auto pr-1 scrollbar-hide">
              {chatMessages.length === 0 && (
                <p className="py-4 text-center text-[11px] text-text-tertiary">发送消息开始对话...</p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${m.role === "assistant" ? "bg-brand/10" : "bg-surface-card border border-surface-border"}`}>
                    {m.role === "assistant" ? <Bot className="h-3 w-3 text-brand" /> : <User className="h-3 w-3 text-text-secondary" />}
                  </div>
                  <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${m.role === "assistant" ? "bg-surface-card border border-surface-border text-text-primary" : "bg-brand text-white"}`}>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10">
                    <Bot className="h-3 w-3 text-brand" />
                  </div>
                  <div className="rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-xs text-text-secondary">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-surface-border bg-surface-card p-2">
              <textarea
                value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); } }}
                placeholder="问问当前 workspace空间..."
                className="h-12 w-full resize-none bg-transparent px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
              <div className="flex items-center justify-between px-1 pt-1">
                <span className="text-[11px] text-text-tertiary">{chatMessages.length > 0 ? `${chatMessages.length} 条消息` : "Enter 发送"}</span>
                <button onClick={handleChatSubmit} disabled={chatLoading || !chatInput.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-40">
                  <Send className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setChatOpen(true)} className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-elevated px-4 py-2.5 text-sm font-medium text-text-primary shadow-xl">
            <Bot className="h-4 w-4 text-brand" />
            AI 空间助手
          </button>
        )}
      </div>

      {/* 新建空间弹窗 */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setCreating(false); setNewName(""); }}>
          <div className="w-[360px] rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-text-primary">新建 workspace空间</h2>
            <p className="mb-4 mt-1 text-xs text-text-tertiary">为你的对话、文件和功能小屋创建一个新空间。</p>
            <input className="w-full rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-brand"
              placeholder="输入空间名称" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }} autoFocus />
            <div className="mt-4 flex items-center gap-2">
              <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">创建</button>
              <button onClick={() => { setCreating(false); setNewName(""); }} className="flex-1 rounded-xl bg-surface-card py-2.5 text-sm text-text-secondary hover:text-text-primary">取消</button>
            </div>
          </div>
        </div>
      )}
      {/* 功能弹窗 */}
      <UploadDialog open={activeDialog === "upload"} onClose={() => setActiveDialog(null)} workspaceId={activeWS?.id || 0} />
      <StudyDialog open={activeDialog === "study"} onClose={() => setActiveDialog(null)} />
      <ConvertDialog open={activeDialog === "convert"} onClose={() => setActiveDialog(null)} workspaceId={activeWS?.id || 0} modelId={selectedModel?.id} />
      <ImageGenDialog open={activeDialog === "image-gen"} onClose={() => setActiveDialog(null)} />
      <ImageEditDialog open={activeDialog === "image-edit"} onClose={() => setActiveDialog(null)} />
      <ToolsDialog open={activeDialog === "tools"} onClose={() => setActiveDialog(null)} />
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[52px] rounded-xl bg-surface-card px-2.5 py-1.5 text-center border border-surface-border/50">
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      <div className="text-[10px] text-text-tertiary">{label}</div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
