"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useModels } from "@/hooks/useModels";
import { useChatBootstrapRuntime } from "@/hooks/useChatBootstrapRuntime";
import ChatInterface from "./ChatInterface";
import { useI18n } from "@/lib/i18n";
import { deriveChatPageState, shouldShowConversationShell } from "@/lib/chatPageState";
import { emitChatRenderProfileEvent } from "@/lib/chatRenderProfile";

function ChatSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col h-full bg-surface items-center justify-center">
      <div className="animate-pulse text-text-tertiary text-sm">{t("chat.loading")}</div>
    </div>
  );
}

function ChatPageStateNotice({ state, onRetry }: { state: string; onRetry: () => void }) {
  const title = state === "conversation-not-found"
    ? "对话不存在"
    : state === "conversation-forbidden"
      ? "无权访问此对话"
      : state === "anonymous"
        ? "需要登录"
        : "对话加载失败";
  const description = state === "conversation-not-found"
    ? "这个会话可能已被删除，或链接不正确。"
    : state === "conversation-forbidden"
      ? "当前账号没有权限查看这个会话。"
      : state === "anonymous"
        ? "请登录后再打开这个会话链接。"
        : "网络或服务异常，请重试。";
  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface px-6 text-center">
      <div className="max-w-sm rounded-3xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
        <button onClick={onRetry} className="mt-5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">重试</button>
      </div>
    </div>
  );
}

export default function ChatContent() {
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams();
  const conversationIdParam = searchParams?.get("id") || searchParams?.get("conversation_id");
  const conversationId = conversationIdParam
    ? Number(conversationIdParam)
    : undefined;
  const newChatToken = searchParams?.get("t") || "default";
  const targetMessageId = searchParams?.get("message")
    ? Number(searchParams?.get("message"))
    : undefined;
  const { models, loading } = useModels();
  const bootstrap = useChatBootstrapRuntime({ conversationId });
  const effectiveModels = bootstrap.models.length > 0 ? bootstrap.models : models;
  const chatPageState = deriveChatPageState({ conversationId, bootstrap });
  const isConversationShellLoading = shouldShowConversationShell(chatPageState);
  const previousConversationIdRef = useRef<number | undefined>(conversationId);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previousConversationId = previousConversationIdRef.current;
    previousConversationIdRef.current = conversationId;
    emitChatRenderProfileEvent("route-conversation-change", {
      previousConversationId,
      conversationId,
      hasTargetMessage: Number.isFinite(targetMessageId),
      loadingModels: loading,
    });
  }, [conversationId, targetMessageId, loading]);

  if (!mounted || (bootstrap.status === "loading" && effectiveModels.length === 0) || (loading && effectiveModels.length === 0)) return <ChatSkeleton />;
  if (chatPageState === "anonymous" || chatPageState === "conversation-not-found" || chatPageState === "conversation-forbidden" || chatPageState === "conversation-error") {
    return <ChatPageStateNotice state={chatPageState} onRetry={() => window.location.reload()} />;
  }

  // 只用 t 参数强制重置“新对话”实例；创建对话后 URL 会从 /chat?t=xxx 变成 /chat?t=xxx&id=123，
  // key 必须保持不变，否则 ChatInterface 会 remount，正在流式写入的本地 assistant 消息会丢失。
  // 历史对话通常不带 t，统一使用稳定 key，由 useChat 内部按 conversationId 加载。
  const chatKey = newChatToken !== "default" ? `new-${newChatToken}` : "chat";
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ChatInterface key={chatKey} conversationId={conversationId} models={effectiveModels} targetMessageId={targetMessageId} bootstrap={bootstrap.payload} isConversationShellLoading={isConversationShellLoading} />
    </div>
  );
}
