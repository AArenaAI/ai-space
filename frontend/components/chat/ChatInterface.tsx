"use client";

import { useState, useCallback, useEffect } from "react";
import { useChat, ChatModel } from "@/hooks/useChat";
import { useTemplates } from "@/hooks/useTemplates";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import ModelSelector from "./ModelSelector";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Columns2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const COMPARE_KEY = "compare-mode";
const COMPARE_MODELS_KEY = "compare-models";

interface ChatInterfaceProps {
  conversationId?: number;
  models: ChatModel[];
}

export default function ChatInterface({ conversationId, models }: ChatInterfaceProps) {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const router = useRouter();

  const {
    messages,
    isLoading,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    deleteMessage,
    regenerateMessage,
    isCompare,
    compareModels,
    sendCompareMessages,
  } = useChat(conversationId, models);

  const { templates } = useTemplates();

  // 初始化时从 localStorage 恢复对比模式状态
  useEffect(() => {
    // 只有在非对比对话时才从 localStorage 恢复
    if (!isCompare) {
      const savedMode = localStorage.getItem(COMPARE_KEY);
      if (savedMode === "true") {
        setCompareMode(true);
        const savedModels = localStorage.getItem(COMPARE_MODELS_KEY);
        if (savedModels) {
          try {
            const parsed = JSON.parse(savedModels);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSelectedModels(parsed);
            } else {
              setSelectedModels(models.slice(0, 2).map((m) => m.id));
            }
          } catch {
            setSelectedModels(models.slice(0, 2).map((m) => m.id));
          }
        } else {
          setSelectedModels(models.slice(0, 2).map((m) => m.id));
        }
      }
    }
  }, []); // 只在挂载时执行

  // 从 localStorage 恢复模板选择，并监听侧边栏模板变化事件
  useEffect(() => {
    const saved = localStorage.getItem("selected-template");
    if (saved) {
      setSelectedTemplateId(Number(saved));
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.templateId !== undefined) {
        setSelectedTemplateId(detail.templateId);
      }
    };
    window.addEventListener("template-changed", handler);
    return () => window.removeEventListener("template-changed", handler);
  }, []);

  // 自动选择默认模板（仅当用户还没手动选过模板时）
  useEffect(() => {
    const saved = localStorage.getItem("selected-template");
    // 如果用户已经手动选过模板（localStorage 中有值），不覆盖
    if (saved !== null) return;
    const defaultTpl = templates.find((t) => t.is_default);
    if (defaultTpl) {
      setSelectedTemplateId(defaultTpl.id);
      localStorage.setItem("selected-template", String(defaultTpl.id));
    }
  }, [templates]);

  // 进入对比对话时自动切换到对比模式并恢复模型选择
  useEffect(() => {
    if (isCompare && compareModels.length > 0) {
      setCompareMode(true);
      setSelectedModels(compareModels);
    } else if (!isCompare && !conversationId) {
      // 新建对话且不是对比对话时，不从 localStorage 恢复（已经通过初始化恢复了）
    }
  }, [isCompare, compareModels, conversationId]);

  const toggleCompareModel = (id: string) => {
    setSelectedModels((prev) => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter((m) => m !== id);
      } else if (prev.length >= 4) {
        toast.warning("最多选择 4 个模型");
        return prev;
      } else {
        next = [...prev, id];
      }
      localStorage.setItem(COMPARE_MODELS_KEY, JSON.stringify(next));
      // 记录最近使用
      try {
        const recent = JSON.parse(localStorage.getItem("recent-models-compare") || "[]");
        const filtered = recent.filter((r: string) => r !== id);
        filtered.unshift(id);
        localStorage.setItem("recent-models-compare", JSON.stringify(filtered.slice(0, 3)));
      } catch {}
      return next;
    });
  };

  const handleSend = async (content: string, reasoning: any, search: boolean) => {
    if (compareMode) {
      // 对比模式 - 依次流式发送给多个模型
      if (selectedModels.length < 2) {
        toast.error("请至少选择 2 个模型");
        return;
      }
      if (selectedTemplateId === 0) {
        toast.error("对比模式必须选择一个回答模板");
        return;
      }
      await sendCompareMessages(content, selectedModels, reasoning, search, selectedTemplateId);
    } else {
      sendMessage(content, reasoning, false, search, selectedTemplateId);
    }
  };

  const handleStop = () => {
      stopGeneration();
  };

  const toggleCompareMode = () => {
    const newMode = !compareMode;
    setCompareMode(newMode);
    if (newMode) {
      // 进入对比模式，恢复上次选中的模型或默认选前 2 个
      const savedModels = localStorage.getItem(COMPARE_MODELS_KEY);
      if (savedModels) {
        try {
          const parsed = JSON.parse(savedModels);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSelectedModels(parsed);
          } else {
            setSelectedModels(models.slice(0, 2).map((m) => m.id));
          }
        } catch {
          setSelectedModels(models.slice(0, 2).map((m) => m.id));
        }
      } else {
        setSelectedModels(models.slice(0, 2).map((m) => m.id));
      }
      // 如果有默认模板自动选上，如果没有则弹出提示
      const defaultTpl = templates.find((t) => t.is_default);
      if (!defaultTpl) {
        toast.warning("对比模式需要模板，请先在侧边栏设置");
      }
      localStorage.setItem(COMPARE_KEY, "true");
    } else {
      // 退出对比模式时清除 localStorage，防止刷新后残留
      localStorage.removeItem(COMPARE_KEY);
      localStorage.removeItem(COMPARE_MODELS_KEY);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 顶部栏 - 48px 高度 */}
      <header className={cn("shrink-0 h-12 flex items-center justify-between px-4 border-b transition-all duration-300", compareMode ? "border-amber-500/20" : "border-surface-border")}>
        <div className="flex items-center">
          <span className="text-sm font-semibold text-text-primary tracking-tight">AI Space</span>
        </div>

        {compareMode && selectedModels.length > 0 ? (
          <div className="relative flex items-center">
            <button
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border bg-surface-card text-sm text-text-primary hover:bg-surface-elevated transition-colors"
            >
              <Columns2 className="w-3.5 h-3.5 text-amber-400" />
              <span>{selectedModels.length} 个模型</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", modelMenuOpen && "rotate-180")} />
            </button>

            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute top-full left-0 mt-2 w-[280px] z-50 rounded-xl border border-surface-border bg-surface-elevated shadow-xl overflow-hidden">
                  <div className="px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-surface-border flex items-center justify-between">
                    <span>选择对比模型</span>
                    <span className="text-[10px] text-amber-400 font-normal normal-case">{selectedModels.length}/4</span>
                  </div>
                  <div className="py-1 max-h-[70vh] overflow-y-auto">
                    {/* 最近使用 */}
                    {(() => {
                      const recentIds = (() => { try { return JSON.parse(localStorage.getItem("recent-models-compare") || "[]"); } catch { return []; } })();
                      const recentModels = recentIds.map((id: string) => models.find(m => m.id === id)).filter(Boolean) as ChatModel[];
                      return recentModels.length > 0 ? (
                        <div className="px-1 pb-1 border-b border-surface-border">
                          <div className="px-2 py-1 text-[10px] font-medium text-text-tertiary tracking-wider flex items-center gap-1">
                            <span>⭐</span>
                            最近使用
                          </div>
                          {recentModels.map((m: ChatModel) => (
                            <label key={m.id} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors duration-150 hover:bg-surface-card cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedModels.includes(m.id)}
                                onChange={(e) => { e.stopPropagation(); toggleCompareModel(m.id); }}
                                className="rounded border-surface-border text-amber-400 focus:ring-amber-400/40 shrink-0"
                              />
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                              <span className="flex-1 text-sm truncate text-text-secondary hover:text-text-primary">{m.name}</span>
                              <p className="text-[11px] text-text-tertiary hidden">{m.description}</p>
                            </label>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* 分组列表 */}
                    <div className="px-1 pt-1">
                      {[
                        { name: "DeepSeek", label: "深度求索", icon: "D", color: "#4d6bfa" },
                        { name: "OpenAI", label: "OpenAI", icon: "O", color: "#10a37f" },
                        { name: "Anthropic", label: "Anthropic", icon: "A", color: "#cc785c" },
                        { name: "Google", label: "Google", icon: "G", color: "#4285f4" },
                        { name: "Moonshot", label: "月之暗面", icon: "K", color: "#00b96b" },
                      ].map((grp) => {
                        const groupModels = models.filter((m) => m.provider === grp.name);
                        if (groupModels.length === 0) return null;
                        return (
                          <div key={grp.name}>
                            <div className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left">
                              <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: grp.color }} />
                              <span className="flex-1 text-xs font-medium text-text-tertiary tracking-wide">{grp.label}</span>
                              <span className="text-[10px] text-text-tertiary/60 tabular-nums">{groupModels.length}</span>
                            </div>
                            <div className="ml-1 pl-2 border-l border-surface-border/50">
                              {groupModels.map((m) => (
                                <label key={m.id} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors duration-150 hover:bg-surface-card cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedModels.includes(m.id)}
                                    onChange={(e) => { e.stopPropagation(); toggleCompareModel(m.id); }}
                                    className="rounded border-surface-border text-amber-400 focus:ring-amber-400/40 shrink-0"
                                  />
                                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                                  <span className="flex-1 text-sm truncate text-text-secondary hover:text-text-primary">{m.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {selectedTemplateId > 0 && (
                    <div className="px-3 py-2 text-[11px] text-text-tertiary border-t border-surface-border flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-amber-400/60 shrink-0" />
                      模板已选
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <ModelSelector
            models={models}
            selected={selectedModel}
            onSelect={setSelectedModel}
          />
        )}

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="w-8 h-8 rounded-full bg-surface-card border border-surface-border flex items-center justify-center">
            <span className="text-xs font-medium text-text-secondary">U</span>
          </div>
        </div>
      </header>
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          isLoading={isLoading}
          models={models}
          conversationId={conversationId}
          onDeleteMessage={deleteMessage}
          onRegenerate={regenerateMessage}
          onContinueGenerate={regenerateMessage}
          isCompare={isCompare}
          compareModels={compareModels}
        />
      </div>

      {/* 输入框 */}
      <div className="shrink-0">
        <MessageInput
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          compareMode={compareMode}
          onToggleCompare={toggleCompareMode}
          currentModel={selectedModel}
        />
      </div>
    </div>
  );
}
