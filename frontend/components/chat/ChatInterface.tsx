"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatModel } from "@/lib/chatTypes";
import type { ChatBootstrapPayload } from "@/lib/chatBootstrapCoordinator";
import { useTemplates } from "@/hooks/useTemplates";
import MessageList from "./MessageList";
import MessageInput, { ReasoningConfig, type QuoteDraft } from "./MessageInput";
import ModelSelector from "./ModelSelector";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Zap, X, Pencil, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { showUserError } from "@/lib/errors";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";
import InputDialog from "@/components/ui/InputDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { ModelRecommendationContext } from "@/lib/models/modelRecommendations";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";
import { useCredits, getTierName, getModelTier, isExpensiveModel } from "@/hooks/useCredits";
import CreditExhaustedModal from "@/components/credits/CreditExhaustedModal";
import { useChatAnalytics, trackCreditUse, trackFeatureUse } from "@/hooks/useAnalytics";

const ForkCompareDialog = dynamic(() => import("./ForkCompareDialog"), {
  ssr: false,
  loading: () => null,
});

const COMPARE_KEY = "compare-mode";
const COMPARE_MODELS_KEY = "compare-models";
const COMPARE_MODEL_LIMIT = 2;
const EMPTY_COMPARE_LAYOUT_DELAY_MS = 520;

function normalizeCompareModelIds(modelIds: string[], models: ChatModel[]): string[] {
  const available = new Set(models.map((model) => model.id));
  const filtered = modelIds.filter((id) => available.has(id));
  const fallback = models.map((model) => model.id);
  return Array.from(new Set([...filtered, ...fallback])).slice(0, COMPARE_MODEL_LIMIT);
}

interface ChatInterfaceProps {
  conversationId?: number;
  notebookId?: number;
  notebookTitle?: string;
  notebookFileCount?: number;
  notebookFileIds?: number[];
  notebookHero?: {
    title: string;
    meta?: string;
    coverClassName?: string;
    icon?: string;
    imageUrl?: string;
    onCustomize?: () => void;
  };
  models: ChatModel[];
  skillKey?: string;
  recommendedModel?: ChatModel;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  targetMessageId?: number;
  externalSendRequest?: { id: number; content: string; hidden?: boolean } | null;
  modelSelectionOptions?: { storageKey?: string; defaultModelId?: string };
  onSaveAssistantToNote?: (content: string) => void;
  bootstrap?: ChatBootstrapPayload;
  isConversationShellLoading?: boolean;
}

const HIDDEN_USER_MESSAGE_PREFIX = "<!-- ai-space:hidden-user-message -->";

export function buildHiddenUserMessageContent(content: string) {
  return `${HIDDEN_USER_MESSAGE_PREFIX}\n${content}`;
}

export default function ChatInterface({ conversationId, notebookId, notebookTitle, notebookFileCount, notebookFileIds, notebookHero, models, skillKey, recommendedModel, welcomeTitle, welcomeSubtitle, welcomeExamples, targetMessageId, externalSendRequest, modelSelectionOptions, onSaveAssistantToNote, bootstrap, isConversationShellLoading = false }: ChatInterfaceProps) {
  const renderStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { t } = useI18n();
  const [compareMode, setCompareMode] = useState(false);
  const [emptyCompareLayoutReady, setEmptyCompareLayoutReady] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const selectedModelsRef = useRef<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);
  const [autoModelNotice, setAutoModelNotice] = useState(false);
  const [isComplexTask, setIsComplexTask] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [forkTargetMessageId, setForkTargetMessageId] = useState<number | null>(null);
  const [compareTargetMessageId, setCompareTargetMessageId] = useState<number | undefined>(undefined);
  const [messageSelectMode, setMessageSelectMode] = useState(false);
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const handledExternalSendIdRef = useRef<number | null>(null);
  const [modelRecommendationContext, setModelRecommendationContext] = useState<ModelRecommendationContext>();
  const [userName, setUserName] = useState<string>("");
  const [creditExhaustedOpen, setCreditExhaustedOpen] = useState(false);
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
    isCurrentConversationGenerating,
    isLoadingHistory,
    selectedModel,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    clearMessages,
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
  } = useChat(conversationId, models, skillKey, notebookId, notebookFileIds, modelSelectionOptions, bootstrap);

  const { templates } = useTemplates();
  const { hasEnoughCredits, getTierCredits, isCreditExhausted, getBetaPhaseInfo, credits, getModelCostFen, getBetaModelBlockedMessage } = useCredits();

  const chatInterfaceProfile = useMemo(() => ({
    conversationId,
    currentConversation,
    messageCount: messages.length,
    isLoading,
    isLoadingHistory,
    isCompare: compareMode || isCompare,
    notebookId,
    targetMessageId,
  }), [conversationId, currentConversation, messages.length, isLoading, isLoadingHistory, compareMode, isCompare, notebookId, targetMessageId]);

  useEffect(() => {
    const commitAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    emitChatRenderProfileEvent("chat-interface-commit", {
      ...chatInterfaceProfile,
      durationMs: commitAt - renderStartedAt,
    });
  }, [chatInterfaceProfile, renderStartedAt]);

  const getSelectedTemplatePayload = useCallback(() => {
    return { templateId: selectedTemplateId, templatePrefix: undefined };
  }, [selectedTemplateId]);

  const applyCompareModels = useCallback((modelIds: string[]) => {
    const normalized = normalizeCompareModelIds(modelIds, models);
    setSelectedModels(normalized);
    selectedModelsRef.current = normalized;
    if (normalized.length > 0) {
      localStorage.setItem(COMPARE_MODELS_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(COMPARE_MODELS_KEY);
    }
    return normalized;
  }, [models]);

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
            applyCompareModels(Array.isArray(parsed) ? parsed : []);
          } catch {
            applyCompareModels([]);
          }
        } else {
          applyCompareModels([]);
        }
      }
    }
  }, [applyCompareModels, isCompare]);

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
      applyCompareModels(compareModels);
    } else if (!isCompare && !conversationId) {
      // 新建对话且不是对比对话时，不从 localStorage 恢复（已经通过初始化恢复了）
    }
  }, [isCompare, compareModels, conversationId, applyCompareModels]);

  const isComplexReasoningTask = (reasoning?: ReasoningConfig | null, modelIds?: string[]) => {
    const ids = modelIds && modelIds.length > 0 ? modelIds : [selectedModel.id];
    if (ids.some((id) => id === "gpt-5.5-pro" || id.startsWith("gpt-5.5-pro-"))) {
      return true;
    }
    if (!reasoning?.enabled) return false;
    return ["extended", "heavy", "high", "max"].includes(reasoning.effort);
  };

  const [expensiveModelConfirmOpen, setExpensiveModelConfirmOpen] = useState(false);
  const [pendingSendPayload, setPendingSendPayload] = useState<{
    content: string;
    reasoning: ReasoningConfig | undefined;
    search: boolean;
    attachments?: { filename: string; content: string; type: string; public_id?: string }[];
    file_ids?: string[];
    skipUserMessage: boolean;
  } | null>(null);

  // 埋点追踪
  const { trackChatStart, trackChatComplete, trackModelSwitch } = useChatAnalytics();
  const prevModelRef = useRef<string>("");

  const handleSend = async (content: string, reasoning: ReasoningConfig | undefined, search: boolean, attachments?: { filename: string; content: string; type: string; public_id?: string }[], file_ids?: string[], skipUserMessage = false) => {
    const activeCompareMode = compareMode || isCompare;
    const currentSelectedModels = activeCompareMode
      ? normalizeCompareModelIds(
          selectedModelsRef.current.length ? selectedModelsRef.current : (selectedModels.length ? selectedModels : compareModels),
          models
        )
      : [selectedModel.id];

    // 内测批次权限检查：被当前 batch 锁定的模型直接提示，不进入 Bad Case 解锁流程。
    const blockedModelId = currentSelectedModels.find((modelId) => getBetaModelBlockedMessage(modelId));
    if (blockedModelId) {
      toast.error(getBetaModelBlockedMessage(blockedModelId) || "当前内测批次暂未开放该模型");
      return;
    }

    // 积分检查：额度不足时弹出 Bad Case 提交模态框。对比模式必须校验所有将要调用的模型。
    // 未激活用户优先提示激活，不显示额度耗尽。
    const firstModelWithoutCredits = currentSelectedModels.find((modelId) => !hasEnoughCredits(modelId));
    if (firstModelWithoutCredits) {
      if (credits?.beta_phase === "") {
        toast.error("🔒 账号未激活：请使用邀请码激活或提交内测申请。");
      } else {
        setCreditExhaustedOpen(true);
      }
      return;
    }

    // 昂贵模型二次确认（Chat 1，22 Credits/次）
    if (currentSelectedModels.some((modelId) => isExpensiveModel(modelId))) {
      setPendingSendPayload({ content, reasoning, search, attachments, file_ids, skipUserMessage: skipUserMessage || false });
      setExpensiveModelConfirmOpen(true);
      return;
    }

    // 埋点：聊天开始
    if (selectedModel) {
      trackChatStart(selectedModel.id, selectedModel.name);
    }

    if (activeCompareMode) {
      // 对比模式 - 依次流式发送给多个模型
      setCompareTargetMessageId(undefined);
      selectedModelsRef.current = currentSelectedModels;
      if (currentSelectedModels.length < 2) {
        toast.error(t("chat.compareMinModels"));
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
      sendMessage(content, reasoning, false, search, templateId, skipUserMessage, attachments, file_ids, templatePrefix);
    }
  };

  useEffect(() => {
    if (!externalSendRequest || handledExternalSendIdRef.current === externalSendRequest.id) return;
    handledExternalSendIdRef.current = externalSendRequest.id;
    handleSend(
      externalSendRequest.hidden ? buildHiddenUserMessageContent(externalSendRequest.content) : externalSendRequest.content,
      undefined,
      false,
      undefined,
      undefined,
      false
    );
  }, [externalSendRequest]);

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
    window.dispatchEvent(new Event("chat-conversation-before-route-change"));
    clearMessages();
    router.push(`/chat?t=${Date.now()}`);
  };

  const handleCompareModelChange = (index: number, modelId: string) => {
    if (index < 0 || index >= COMPARE_MODEL_LIMIT) return;
    setSelectedModels((prev) => {
      const fallback = prev.length ? prev : models.slice(0, COMPARE_MODEL_LIMIT).map((m) => m.id);
      const next = [...fallback].slice(0, COMPARE_MODEL_LIMIT);
      while (next.length <= index && next.length < COMPARE_MODEL_LIMIT) {
        next.push(models[next.length]?.id || modelId);
      }
      const oldModelId = next[index];
      next[index] = modelId;
      const normalized = normalizeCompareModelIds(next, models);
      selectedModelsRef.current = normalized;
      localStorage.setItem(COMPARE_MODELS_KEY, JSON.stringify(normalized));
      // 埋点：模型切换
      if (oldModelId && oldModelId !== modelId) {
        trackModelSwitch(oldModelId, modelId);
      }
      return normalized;
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
          applyCompareModels(Array.isArray(parsed) ? parsed : []);
        } catch {
          applyCompareModels([]);
        }
      } else {
        applyCompareModels([]);
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
    setCompareTargetMessageId(undefined);
    localStorage.removeItem(COMPARE_KEY);
    localStorage.removeItem(COMPARE_MODELS_KEY);
    setSelectedModels([]);
    selectedModelsRef.current = [];
    setIsCompare(false);
    setCompareModels([]);

    if (conversationId) {
      const token = localStorage.getItem("token");
      if (token) {
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ compare: false, compare_models: "[]" }),
        }).then((response) => {
          if (response.ok) {
            window.dispatchEvent(new CustomEvent("conversation-updated", { detail: { conversationId } }));
          }
        }).catch(() => {
          // Local exit should still work; backend state will be retried on a future explicit exit.
        });
      }
    }
  }, [conversationId, setCompareMode, setIsCompare, setCompareModels]);
  const activeSelectedModelIds = selectedModels.length > 0 ? selectedModels : compareModels;
  const inputCompareModels = useMemo(
    () => activeSelectedModelIds
      .map((modelId) => models.find((model) => model.id === modelId))
      .filter((model): model is ChatModel => Boolean(model)),
    [activeSelectedModelIds, models]
  );

  const activeCompareMode = compareMode || isCompare;
  const inputIsLoading = isCurrentConversationGenerating;
  const activeCompareModelIds = compareMode ? selectedModels : (compareModels.length > 0 ? compareModels : selectedModels);
  const activeTargetMessageId = compareTargetMessageId ?? (currentConversation === conversationId ? targetMessageId : undefined);
  const isEmptyNewCompareMode = messages.length === 0 && !conversationId && activeCompareMode;
  const shouldDelayEmptyCompareLayout = isEmptyNewCompareMode && !emptyCompareLayoutReady;
  const isNewEmptyChat = messages.length === 0 && !conversationId && !activeCompareMode && !isConversationShellLoading;

  useEffect(() => {
    if (!isEmptyNewCompareMode) {
      setEmptyCompareLayoutReady(false);
      return;
    }
    setEmptyCompareLayoutReady(false);
    const timer = window.setTimeout(() => setEmptyCompareLayoutReady(true), EMPTY_COMPARE_LAYOUT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isEmptyNewCompareMode]);

  const hasNotebookHeroImage = Boolean(notebookHero?.imageUrl);
  const notebookHeroUsesDarkText = Boolean(notebookHero && !hasNotebookHeroImage && !notebookHero.coverClassName?.includes("text-white"));

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 顶部栏 - 对比模式下隐藏，释放垂直空间 */}
      {!activeCompareMode && (
        <header className="relative z-20 shrink-0 h-12 flex items-center justify-between px-4 transition-all duration-300">
          <div className="flex items-center">
            <ModelSelector
              models={models}
              selected={selectedModel}
              onSelect={(model) => {
                if (prevModelRef.current && prevModelRef.current !== model.id) {
                  trackModelSwitch(prevModelRef.current, model.id);
                }
                prevModelRef.current = model.id;
                handleModelSelect(model);
              }}
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

      {notebookHero && !activeCompareMode && (
        <div className="relative z-30 shrink-0 px-4 pb-3">
          <div className={cn("group relative min-h-[204px] overflow-hidden rounded-[28px] px-6 py-5 shadow-sm ring-1 ring-black/5", hasNotebookHeroImage ? "bg-slate-900 text-white" : notebookHero.coverClassName || "bg-gradient-to-br from-[#edf4ff] via-[#eef0ff] to-[#f6efff] text-slate-950")}>
            {hasNotebookHeroImage ? (
              <>
                <img src={notebookHero.imageUrl} alt="笔记本底图" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-transparent to-transparent" />
              </>
            ) : (
              <>
                <div className="pointer-events-none absolute -right-10 -bottom-14 h-36 w-36 rotate-12 rounded-[34px] bg-fuchsia-400/10 transition duration-500 group-hover:scale-[1.03]" />
                <div className="pointer-events-none absolute right-10 bottom-4 h-20 w-28 -rotate-6 rounded-[28px] bg-indigo-300/10 transition duration-500 group-hover:scale-[1.03]" />
                <img src="/brand-dark-logo.png" alt="AI Space" className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 object-contain opacity-90" />
              </>
            )}

            <div className="relative z-10 flex h-full min-h-[164px] flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                {notebookHero.icon && (
                  <div className={cn("inline-flex h-10 min-w-10 items-center justify-center rounded-full px-2.5 text-sm font-black leading-none shadow-sm ring-1 ring-black/10", notebookHeroUsesDarkText ? "bg-white/70 text-slate-900" : "bg-white/92 text-slate-900")}>
                    {notebookHero.icon}
                  </div>
                )}
                <div className="ml-auto">
                  {notebookHero.onCustomize && (
                    <button
                      type="button"
                      onClick={notebookHero.onCustomize}
                      className={cn("relative z-20 inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm ring-1 ring-black/5 transition group-hover:shadow-md", notebookHeroUsesDarkText ? "bg-white/70 text-slate-700 hover:bg-white/90 hover:text-slate-950" : "bg-white/92 text-slate-700 hover:bg-white hover:text-slate-950")}
                    >
                      <Pencil className="h-4 w-4" />
                      自定义
                    </button>
                  )}
                </div>
              </div>

              <div className="max-w-2xl">
                <h1 className={cn("text-[28px] font-bold leading-[1.08] tracking-[-0.04em]", notebookHeroUsesDarkText ? "text-slate-950" : "text-white drop-shadow-sm")}>
                  {notebookHero.title}
                </h1>
                {notebookHero.meta && <p className={cn("mt-3 text-sm font-medium", notebookHeroUsesDarkText ? "text-slate-600" : "text-white/82")}>{notebookHero.meta}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 消息列表 - 有消息时渲染 */}
      {!isNewEmptyChat && (
        <MessageList
          messages={messages}
          isLoading={isLoading}
          isLoadingHistory={isLoadingHistory}
          isConversationShellLoading={isConversationShellLoading}
          isComplexTask={isComplexTask}
          models={models}
          conversationId={conversationId}
          onDeleteMessage={deleteMessage}
          onRegenerate={regenerateMessage}
          onContinueGenerate={regenerateMessage}
          isCompare={activeCompareMode}
          compareModels={activeCompareModelIds}
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
          targetMessageId={activeTargetMessageId}
          onSelectModeChange={setMessageSelectMode}
          onExitCompare={handleExitCompare}
          onQuoteSelection={handleQuoteSelection}
          onSaveAssistantToNote={notebookId ? onSaveAssistantToNote : undefined}
          onActivityOpenChange={setActivityPanelOpen}
        />
      )}

      {/* 空状态容器 - 只在真正新空对话时渲染，避免历史会话 DOM 中残留 welcome 文案 */}
      {isNewEmptyChat && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
          <div className="mb-6 w-fit max-w-md text-left">
            {welcomeTitle ? (
              <>
                <div className="mb-6 flex h-12 w-12 items-center justify-center text-[34px] leading-none">
                  👋
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
                isLoading={inputIsLoading}
                compareMode={activeCompareMode}
                onToggleCompare={toggleCompareMode}
                currentModel={selectedModel}
                compareModels={inputCompareModels}
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
      )}

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
          currentModelId={messages.find((message) => message.serverMessageId === forkTargetMessageId)?.model || selectedModel.id}
          onConfirm={(modelIds) => {
            if (!forkTargetMessageId) return;
            const sourceModelId = messages.find((message) => message.serverMessageId === forkTargetMessageId)?.model || selectedModel.id;
            const allModelIds = [sourceModelId, ...modelIds];
            const normalizedModelIds = normalizeCompareModelIds(allModelIds, models);
            setCompareTargetMessageId(forkTargetMessageId);
            setIsCompare(true);
            setCompareModels(normalizedModelIds);
            setSelectedModels(normalizedModelIds);
            selectedModelsRef.current = normalizedModelIds;
            toast.success(t("chat.compareStarted"));
            void forkChat(forkTargetMessageId, normalizedModelIds).catch((err) => {
              showUserError(err, { module: "chat", fallbackTitle: t("chat.forkCompareFailed"), fallbackMessage: t("chat.forkCompareFailed") });
            });
          }}
        />
      )}

      {/* 底部输入框 - 始终渲染，空状态时隐藏在下方 */}
      {!messageSelectMode && (
        <div className={cn(
          "z-[70] absolute inset-x-0 bottom-0 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          activityPanelOpen && !activeCompareMode && "lg:right-[336px]",
          isNewEmptyChat
            ? "opacity-0 translate-y-20 scale-95 pointer-events-none"
            : "opacity-100 translate-y-0 scale-100 pointer-events-auto"
        )}>
          <div className="pointer-events-none bg-gradient-to-t from-surface-elevated via-surface-elevated via-60% to-transparent pt-10">
            <div className="pointer-events-auto relative z-[70]">
              <MessageInput
                onSend={handleSend}
                onStop={handleStop}
                isLoading={inputIsLoading}
                compareMode={activeCompareMode}
                onToggleCompare={toggleCompareMode}
                currentModel={selectedModel}
                compareModels={inputCompareModels}
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

      {/* 额度耗尽 - Bad Case 提交模态框 */}
      <CreditExhaustedModal
        open={creditExhaustedOpen}
        onClose={() => setCreditExhaustedOpen(false)}
        onSubmit={async (data) => {
          const token = localStorage.getItem("token");
          if (!token) throw new Error("未登录");
          const res = await fetch("/api/bad-cases", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "提交失败" }));
            throw new Error(err.error || "提交失败");
          }
          // 埋点：Bad Case 提交
          trackFeatureUse("bad_case_submit", { model_id: data.model_id });
        }}
        currentModel={selectedModel ? { id: selectedModel.id, name: selectedModel.name || selectedModel.id } : undefined}
        conversationId={conversationId}
        tierName={selectedModel ? getTierName(getModelTier(selectedModel.id)) : undefined}
        betaPhaseInfo={getBetaPhaseInfo()}
      />

      {/* 昂贵模型二次确认弹窗 */}
      {expensiveModelConfirmOpen && pendingSendPayload && (
        <ConfirmDialog
          open={expensiveModelConfirmOpen}
          onClose={() => {
            setExpensiveModelConfirmOpen(false);
            setPendingSendPayload(null);
          }}
          onConfirm={() => {
            const payload = pendingSendPayload;
            setExpensiveModelConfirmOpen(false);
            setPendingSendPayload(null);
            // 继续发送
            const activeCompareMode = compareMode || isCompare;
            if (activeCompareMode) {
              setCompareTargetMessageId(undefined);
              const currentSelectedModels = normalizeCompareModelIds(
                selectedModelsRef.current.length ? selectedModelsRef.current : (selectedModels.length ? selectedModels : compareModels),
                models
              );
              selectedModelsRef.current = currentSelectedModels;
              if (currentSelectedModels.length >= 2) {
                setIsComplexTask(isComplexReasoningTask(payload.reasoning, currentSelectedModels));
                const { templateId, templatePrefix } = getSelectedTemplatePayload();
                sendCompareMessages(payload.content, currentSelectedModels, payload.reasoning, payload.search, templateId, payload.attachments, payload.file_ids, templatePrefix);
              }
            } else {
              setIsComplexTask(isComplexReasoningTask(payload.reasoning));
              const { templateId, templatePrefix } = getSelectedTemplatePayload();
              sendMessage(payload.content, payload.reasoning, false, payload.search, templateId, payload.skipUserMessage, payload.attachments, payload.file_ids, templatePrefix);
            }
          }}
          title="⚠️ 极度深度推理确认"
          description={`本次极度深度推理将消耗 ${((selectedModel ? getModelCostFen(selectedModel.id) : 2200) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} Credits，确定执行？当前${credits?.beta_phase && credits.beta_phase !== "completed" ? "内测" : "精英"}余额：${((credits?.beta_phase && credits.beta_phase !== "completed" ? (credits?.beta_credit_balance || 0) : (credits?.elite_credits || 0)) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} Credits。`}
          confirmText={`确认执行（${((selectedModel ? getModelCostFen(selectedModel.id) : 2200) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} Credits）`}
          cancelText="取消"
          variant="danger"
        />
      )}
    </div>
  );
}
