"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatModel } from "@/lib/chatTypes";
import { useTemplates } from "@/hooks/useTemplates";
import MessageList from "./MessageList";
import MessageInput, { ReasoningConfig, type QuoteDraft } from "./MessageInput";
import ModelSelector from "./ModelSelector";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Zap, X, Pencil, Bot, BookOpen, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { showUserError } from "@/lib/errors";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";
import InputDialog from "@/components/ui/InputDialog";
import type { ModelRecommendationContext } from "@/lib/models/modelRecommendations";

const ForkCompareDialog = dynamic(() => import("./ForkCompareDialog"), {
  ssr: false,
  loading: () => null,
});

const COMPARE_KEY = "compare-mode";
const COMPARE_MODELS_KEY = "compare-models";

interface ChatInterfaceProps {
  conversationId?: number;
  notebookId?: number;
  notebookTitle?: string;
  notebookFileCount?: number;
  notebookFileIds?: number[];
  models: ChatModel[];
  skillKey?: string;
  recommendedModel?: ChatModel;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  targetMessageId?: number;
}

export default function ChatInterface({ conversationId, notebookId, notebookTitle, notebookFileCount, notebookFileIds, models, skillKey, recommendedModel, welcomeTitle, welcomeSubtitle, welcomeExamples, targetMessageId }: ChatInterfaceProps) {
  const { t } = useI18n();
  const [compareMode, setCompareMode] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const selectedModelsRef = useRef<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);
  const [autoModelNotice, setAutoModelNotice] = useState(false);
  const [isComplexTask, setIsComplexTask] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [forkTargetMessageId, setForkTargetMessageId] = useState<number | null>(null);
  const [messageSelectMode, setMessageSelectMode] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [modelRecommendationContext, setModelRecommendationContext] = useState<ModelRecommendationContext>();
  const [userName, setUserName] = useState<string>("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserName(parsed.name || parsed.email || "");
      }
    } catch {}
  }, []);
  const router = useRouter();

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  const {
    messages,
    isLoading,
    isLoadingHistory,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    deleteMessage,
    regenerateMessage,
    currentConversation,
    effectiveSkillKey,
    isCompare,
    setIsCompare,
    compareModels,
    setCompareModels,
    sendCompareMessages,
    groupViews,
    switchGroupModel,
    forkChat,
    conversationTitle,
    setConversationTitle,
    isLoadingMore,
    hasMoreMessages,
    loadMoreMessages,
  } = useChat(conversationId, models, skillKey, notebookId, notebookFileIds);

  const { templates } = useTemplates();

  const getSelectedTemplatePayload = useCallback(() => {
    return { templateId: selectedTemplateId, templatePrefix: undefined };
  }, [selectedTemplateId]);

  const handleModelSelect = useCallback((model: ChatModel) => {
    // 如果当前是 Skill 技能对话且有推荐模型，保存用户覆盖标记
    if (effectiveSkillKey && recommendedModel) {
      localStorage.setItem(`skill-model-override:${effectiveSkillKey}`, model.id);
      setAutoModelNotice(false);
    }
    setSelectedModel(model);
  }, [effectiveSkillKey, recommendedModel, setSelectedModel]);

  // Skill 自动选择推荐模型（允许用户覆盖）
  // 只在空对话/未生成时自动切。生成中切模型会让用户误以为当前流被切到推荐模型，
  // 也可能触发上层状态刷新后丢失正在流式展示的内容。
  useEffect(() => {
    if (!effectiveSkillKey || !recommendedModel || models.length === 0) {
      setAutoModelNotice(false);
      return;
    }
    if (isLoading || messages.length > 0) {
      return;
    }
    const overrideKey = `skill-model-override:${effectiveSkillKey}`;
    const overrideId = localStorage.getItem(overrideKey);
    if (overrideId) {
      // 用户之前覆盖过，使用其选择
      const model = models.find((m) => m.id === overrideId);
      if (model && model.id !== selectedModel.id) {
        setSelectedModel(model);
      }
      setAutoModelNotice(false);
    } else {
      // 自动应用推荐模型
      if (recommendedModel.id !== selectedModel.id) {
        setSelectedModel(recommendedModel);
      }
      setAutoModelNotice(true);
    }
  }, [effectiveSkillKey, recommendedModel, models, selectedModel.id, setSelectedModel, isLoading, messages.length]);

  // 创建对话后更新 URL（保留 skillKey 参数）
  useEffect(() => {
    if (currentConversation && !conversationId) {
      const url = new URL(window.location.href);
      url.searchParams.set("id", String(currentConversation));
      if (!url.searchParams.get("key") && effectiveSkillKey) {
        url.searchParams.set("key", effectiveSkillKey);
      }
      if (notebookId) {
        url.searchParams.set("notebook_id", String(notebookId));
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, [currentConversation, conversationId, effectiveSkillKey]);

  const handleRename = async (newTitle: string) => {
    if (!conversationId || !newTitle.trim()) {
      setRenameOpen(false);
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const r = await fetch(`/api/conversations/${conversationId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (r.ok) {
        const u = await r.json();
        setConversationTitle(u.title || newTitle.trim());
        toast.success(t("chat.renameSuccess"));
        // 触发侧边栏刷新
        window.dispatchEvent(new CustomEvent("conversation-renamed", { detail: { id: conversationId, title: u.title } }));
      } else {
        toast.error(t("chat.renameFailed"));
      }
    } catch {
      toast.error(t("chat.renameFailed"));
    }
    setRenameOpen(false);
  };

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

  // 进入对比对话时自动切换到对比模式并恢复模型选择
  useEffect(() => {
    if (isCompare && compareModels.length > 0) {
      setCompareMode(true);
      setSelectedModels(compareModels);
    } else if (!isCompare && !conversationId) {
      // 新建对话且不是对比对话时，不从 localStorage 恢复（已经通过初始化恢复了）
    }
  }, [isCompare, compareModels, conversationId]);

  const isComplexReasoningTask = (reasoning?: ReasoningConfig | null, modelIds?: string[]) => {
    const ids = modelIds && modelIds.length > 0 ? modelIds : [selectedModel.id];
    if (ids.some((id) => id === "gpt-5.5-pro" || id.startsWith("gpt-5.5-pro-"))) {
      return true;
    }
    if (!reasoning?.enabled) return false;
    return ["extended", "heavy", "high", "max"].includes(reasoning.effort);
  };

  const handleSend = async (content: string, reasoning: ReasoningConfig, search: boolean, attachments?: { filename: string; content: string; type: string; public_id?: string }[], file_ids?: string[]) => {
    // 【积分限制已临时取消】保畔代码但不执行
    /* Credit checks are temporarily disabled.
     * If re-enabled, route insufficient-credit messages through i18n keys instead of hardcoded copy.
     */

    if (compareMode) {
      // 对比模式 - 依次流式发送给多个模型
      const currentSelectedModels = selectedModelsRef.current.length ? selectedModelsRef.current : selectedModels;
      if (currentSelectedModels.length < 2) {
        toast.error(t("chat.compareMinModels"));
        return;
      }
      if (!selectedTemplateId) {
        toast.error(t("chat.compareNeedTemplate"));
        return;
      }
      // 前端目前没有后端返回的任务复杂度字段，先用用户发送时选择的推理档位判断复杂任务
      setIsComplexTask(isComplexReasoningTask(reasoning, currentSelectedModels));
      const { templateId, templatePrefix } = getSelectedTemplatePayload();
      await sendCompareMessages(content, currentSelectedModels, reasoning, search, templateId, attachments, file_ids, templatePrefix);
    } else {
      // 前端目前没有后端返回的任务复杂度字段，先用用户发送时选择的推理档位判断复杂任务
      setIsComplexTask(isComplexReasoningTask(reasoning));
      const { templateId, templatePrefix } = getSelectedTemplatePayload();
      sendMessage(content, reasoning, false, search, templateId, false, attachments, file_ids, templatePrefix);
    }
  };

  const handleStop = () => {
      stopGeneration();
  };

  const handleQuoteSelection = useCallback((quote: string) => {
    setQuoteDraft({ id: Date.now(), text: quote });
  }, []);

  const handleTemplateSelect = (templateId: number) => {
    setSelectedTemplateId(templateId);
    localStorage.setItem("selected-template", String(templateId));
    window.dispatchEvent(new CustomEvent("template-changed", { detail: { templateId } }));
  };

  const handleNewChat = () => {
    router.push(`/chat?t=${Date.now()}`);
  };

  const handleCompareModelChange = (index: number, modelId: string) => {
    setSelectedModels((prev) => {
      const fallback = prev.length ? prev : models.slice(0, Math.max(index + 1, 2)).map((m) => m.id);
      const next = [...fallback];
      while (next.length <= index) {
        next.push(models[next.length]?.id || modelId);
      }
      next[index] = modelId;
      selectedModelsRef.current = next;
      localStorage.setItem(COMPARE_MODELS_KEY, JSON.stringify(next));
      return next;
    });
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
      // 对比模式需要先选择一个回答模板
      if (!selectedTemplateId) {
        toast.warning(t("chat.compareNeedTemplateSidebar"));
      }
      localStorage.setItem(COMPARE_KEY, "true");
    } else {
      // 退出对比模式时清除 localStorage，防止刷新后残留
      localStorage.removeItem(COMPARE_KEY);
      localStorage.removeItem(COMPARE_MODELS_KEY);
      // 同步清除 useChat 的对比状态，确保能完全退出
      setIsCompare(false);
      setCompareModels([]);
    }
  };

  const handleExitCompare = useCallback(() => {
    setCompareMode(false);
    localStorage.removeItem(COMPARE_KEY);
    localStorage.removeItem(COMPARE_MODELS_KEY);
    setIsCompare(false);
    setCompareModels([]);
  }, [setCompareMode, setIsCompare, setCompareModels]);

  const isNewEmptyChat = messages.length === 0 && !conversationId;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 顶部栏 - 对比模式下隐藏，释放垂直空间 */}
      {!(compareMode || isCompare) && (
        <header className="relative z-20 shrink-0 h-12 flex items-center justify-between px-4 transition-all duration-300">
          <div className="flex items-center">
            <ModelSelector
              models={models}
              selected={selectedModel}
              onSelect={handleModelSelect}
              recommendationContext={modelRecommendationContext}
            />
          </div>

          {/* 中间：对话标题 + 编辑 */}
          {conversationTitle && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 max-w-[50%]">
              <span className="text-base font-bold text-text-primary truncate">{conversationTitle}</span>
              <button
                onClick={() => setRenameOpen(true)}
                className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors shrink-0"
                title={t("chat.rename")}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {notebookId && (
              <div className="hidden items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1.5 text-xs font-medium text-brand sm:flex">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="max-w-[180px] truncate">{notebookTitle || t("sidebar.nav.notebook")}</span>
                <span className="inline-flex items-center gap-1 text-brand/80">
                  <FileText className="h-3 w-3" />
                  {notebookFileCount ?? 0}
                </span>
              </div>
            )}
            <ThemeToggle />
          </div>
        </header>
      )}

      {/* 自动选择模型提示条 */}
      {autoModelNotice && recommendedModel && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/5 border-b border-amber-500/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[13px] text-amber-600 dark:text-amber-400 truncate">
              {t("chat.autoModelEnabledPrefix")} <span className="font-semibold">{recommendedModel.name}</span> {t("chat.autoModelEnabledSuffix")}
            </span>
          </div>
          <button
            onClick={() => setAutoModelNotice(false)}
            className="p-1 rounded-md text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 消息列表 - 有消息时渲染 */}
      {!isNewEmptyChat && (
        <MessageList
          messages={messages}
          isLoading={isLoading}
          isLoadingHistory={isLoadingHistory}
          isComplexTask={isComplexTask}
          models={models}
          conversationId={conversationId}
          onDeleteMessage={deleteMessage}
          onRegenerate={regenerateMessage}
          onContinueGenerate={regenerateMessage}
          isCompare={compareMode || isCompare}
          compareModels={(compareMode ? selectedModels : compareModels)}
          onCompareModelChange={handleCompareModelChange}
          welcomeTitle={welcomeTitle}
          welcomeSubtitle={welcomeSubtitle}
          welcomeExamples={welcomeExamples}
          onExampleClick={(prompt) => {
            setIsComplexTask(isComplexReasoningTask(undefined));
            const { templateId, templatePrefix } = getSelectedTemplatePayload();
            sendMessage(prompt, undefined, false, false, templateId, false, undefined, undefined, templatePrefix);
          }}
          groupViews={groupViews}
          switchGroupModel={switchGroupModel}
          onForkCompare={(messageId) => {
            setForkTargetMessageId(messageId);
            setForkDialogOpen(true);
          }}
          isLoadingMore={isLoadingMore}
          hasMoreMessages={hasMoreMessages}
          onLoadMore={loadMoreMessages}
          targetMessageId={currentConversation === conversationId ? targetMessageId : undefined}
          onSelectModeChange={setMessageSelectMode}
          onExitCompare={handleExitCompare}
          onQuoteSelection={handleQuoteSelection}
        />
      )}

      {/* 空状态容器 - 始终渲染，通过 opacity/translate/scale 切换 */}
      <div className={cn(
        "absolute inset-0 flex flex-col items-center justify-center px-4 z-10 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        isNewEmptyChat
          ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
          : "opacity-0 -translate-y-12 scale-95 pointer-events-none"
      )}>
        <div className="text-center max-w-md mb-6">
          {welcomeTitle ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-6">
                <Bot className="w-5 h-5 text-text-secondary" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight mb-2 text-text-primary">{welcomeTitle}</h2>
              {welcomeSubtitle && (
                <p className="text-text-secondary text-sm leading-relaxed mb-8">{welcomeSubtitle}</p>
              )}
            </>
          ) : (
            <>
              <h1 className="text-[32px] font-semibold leading-tight tracking-tight mb-2 text-text-primary">
                {userName ? t("chat.userGreeting").replace("{name}", userName) : t("chat.greeting")}
              </h1>
              <p className="text-[25px] font-medium leading-tight tracking-tight text-text-primary/80">{t("chat.whatCanWeDo")}</p>
            </>
          )}
        </div>
        {!messageSelectMode && (
          <div className="w-full max-w-2xl relative shrink-0">
            <MessageInput
              onSend={handleSend}
              onStop={handleStop}
              isLoading={isLoading}
              compareMode={compareMode}
              onToggleCompare={toggleCompareMode}
              currentModel={selectedModel}
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={handleTemplateSelect}
              onNewChat={handleNewChat}
              onRecommendationContextChange={setModelRecommendationContext}
              quoteDraft={quoteDraft}
            />
          </div>
        )}
      </div>

      {/* 重命名对话 */}
      <InputDialog
        isOpen={renameOpen}
        title={t("chat.renameConversation")}
        defaultValue={conversationTitle}
        placeholder={t("chat.renamePlaceholder")}
        confirmText={t("common.save")}
        cancelText={t("common.cancel")}
        onConfirm={handleRename}
        onCancel={() => setRenameOpen(false)}
      />

      {/* Fork 对比弹窗 */}
      {forkDialogOpen && (
        <ForkCompareDialog
          open={forkDialogOpen}
          onClose={() => { setForkDialogOpen(false); setForkTargetMessageId(null); }}
          models={models}
          currentModelId={selectedModel.id}
          onConfirm={async (modelIds) => {
            if (!forkTargetMessageId) return;
            const allModelIds = [selectedModel.id, ...modelIds];
            try {
              await forkChat(forkTargetMessageId, allModelIds);
              toast.success(t("chat.compareStarted"));
            } catch (err) {
              showUserError(err, { module: "chat", fallbackTitle: t("chat.forkCompareFailed"), fallbackMessage: t("chat.forkCompareFailed") });
            }
          }}
        />
      )}

      {/* 底部输入框 - 始终渲染，空状态时隐藏在下方 */}
      {!messageSelectMode && (
        <div className={cn(
          "z-[70] w-full absolute inset-x-0 bottom-0 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          isNewEmptyChat
            ? "opacity-0 translate-y-20 scale-95 pointer-events-none"
            : "opacity-100 translate-y-0 scale-100 pointer-events-auto"
        )}>
          <div className="pointer-events-none bg-gradient-to-t from-surface-elevated via-surface-elevated via-60% to-transparent pt-10">
            <div className="pointer-events-auto relative z-[70]">
              <MessageInput
                onSend={handleSend}
                onStop={handleStop}
                isLoading={isLoading}
                compareMode={compareMode}
                onToggleCompare={toggleCompareMode}
                currentModel={selectedModel}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={handleTemplateSelect}
                onNewChat={handleNewChat}
                quoteDraft={quoteDraft}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
