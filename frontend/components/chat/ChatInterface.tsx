"use client";

import { useState, useCallback, useEffect } from "react";
import { useChat, ChatModel } from "@/hooks/useChat";
import { useTemplates } from "@/hooks/useTemplates";
import MessageList from "./MessageList";
import MessageInput, { ReasoningConfig } from "./MessageInput";
import ModelSelector from "./ModelSelector";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Columns2, Zap, X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getLocalizedDefaultTemplatePrefix, localizeSystemDefaultTemplate } from "@/lib/defaultTemplates";
import InputDialog from "@/components/ui/InputDialog";
import ForkCompareDialog from "./ForkCompareDialog";

const COMPARE_KEY = "compare-mode";
const COMPARE_MODELS_KEY = "compare-models";

interface ChatInterfaceProps {
  conversationId?: number;
  models: ChatModel[];
  skillKey?: string;
  recommendedModel?: ChatModel;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  welcomeExamples?: { title: string; desc: string; prompt: string }[];
  targetMessageId?: number;
}

export default function ChatInterface({ conversationId, models, skillKey, recommendedModel, welcomeTitle, welcomeSubtitle, welcomeExamples, targetMessageId }: ChatInterfaceProps) {
  const { t, language } = useI18n();
  const [compareMode, setCompareMode] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);
  const [autoModelNotice, setAutoModelNotice] = useState(false);
  const [isComplexTask, setIsComplexTask] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [forkTargetMessageId, setForkTargetMessageId] = useState<number | null>(null);
  const [messageSelectMode, setMessageSelectMode] = useState(false);
  const router = useRouter();

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
  } = useChat(conversationId, models, skillKey);

  const { templates } = useTemplates();
  const localizedTemplates = templates.map((tpl) => localizeSystemDefaultTemplate(tpl, language));

  const getSelectedTemplatePayload = useCallback(() => {
    const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);
    if (selectedTemplate?.is_default) {
      return {
        templateId: selectedTemplateId,
        templatePrefix: getLocalizedDefaultTemplatePrefix(language),
      };
    }
    return { templateId: selectedTemplateId, templatePrefix: undefined };
  }, [templates, selectedTemplateId, language]);

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
    /* 积分检查已注释
    if (compareMode) {
      // 对比模式：检查所有选中模型的积分
      for (const modelId of selectedModels) {
        if (!hasEnoughCredits(modelId)) {
          const tier = getModelTier(modelId);
          toast.error(`模型 ${models.find(m => m.id === modelId)?.name || modelId} 的${tier === "basic" ? "基础" : tier === "advanced" ? "高级" : "精英"}积分不足，请升级套餐`);
          return;
        }
      }
      // 扣减积分
      for (const modelId of selectedModels) {
        await deductCredits(modelId, 1);
      }
    } else {
      // 单模型模式
      if (!hasEnoughCredits(selectedModel.id)) {
        const tier = getModelTier(selectedModel.id);
        toast.error(`${tier === "basic" ? "基础" : tier === "advanced" ? "高级" : "精英"}积分不足，请升级套餐`);
        return;
      }
      await deductCredits(selectedModel.id, 1);
    }
    */

    if (compareMode) {
      // 对比模式 - 依次流式发送给多个模型
      if (selectedModels.length < 2) {
        toast.error(t("chat.compareMinModels"));
        return;
      }
      if (!selectedTemplateId) {
        toast.error(t("chat.compareNeedTemplate"));
        return;
      }
      // 前端目前没有后端返回的任务复杂度字段，先用用户发送时选择的推理档位判断复杂任务
      setIsComplexTask(isComplexReasoningTask(reasoning, selectedModels));
      const { templateId, templatePrefix } = getSelectedTemplatePayload();
      await sendCompareMessages(content, selectedModels, reasoning, search, templateId, attachments, file_ids, templatePrefix);
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
      const next = [...prev];
      if (index < next.length) {
        next[index] = modelId;
      }
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
      // 如果有默认模板自动选上，如果没有则弹出提示
      const defaultTpl = templates.find((t) => t.is_default);
      if (!defaultTpl) {
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

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 顶部栏 - 48px 高度 */}
      <header className={compareMode ? "relative shrink-0 h-12 flex items-center justify-between px-4 transition-all duration-300 border-b border-amber-500/20" : "relative shrink-0 h-12 flex items-center justify-between px-4 transition-all duration-300"}>
        <div className="flex items-center">
          {compareMode ? (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary">
              <Columns2 className="w-3.5 h-3.5 text-amber-400" />
              <span>{t("chat.compareMode")}</span>
            </div>
          ) : (
            <ModelSelector
              models={models}
              selected={selectedModel}
              onSelect={handleModelSelect}
            />
          )}
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

      {/* 消息列表 */}
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
      />

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
          } catch (err: any) {
            toast.error(err.message || t("chat.forkCompareFailed"));
          }
        }}
      />

      {!messageSelectMode && (
        /* 输入框：脱离列表文档流，固定在底部，避免生成时挤压消息区 */
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[70] bg-gradient-to-t from-surface-elevated via-surface-elevated to-transparent pt-6">
          <div className="pointer-events-auto relative z-[70]">
          <MessageInput
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isLoading}
            compareMode={compareMode}
            onToggleCompare={toggleCompareMode}
            currentModel={selectedModel}
            templates={localizedTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={handleTemplateSelect}
            onNewChat={handleNewChat}
          />
          </div>
        </div>
      )}
    </div>
  );
}
