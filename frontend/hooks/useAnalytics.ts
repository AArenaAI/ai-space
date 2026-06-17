import { useCallback, useEffect, useRef } from "react";

// 追踪事件类型
export type AnalyticsEventType =
  | "page_view"
  | "chat_start"
  | "chat_complete"
  | "model_switch"
  | "credit_use"
  | "beta_apply"
  | "invite_use"
  | "bad_case_submit"
  | "error"
  | "click"
  | "scroll"
  | "feature_use";

interface TrackEventPayload {
  event_type: AnalyticsEventType;
  event_name?: string;
  page_path?: string;
  model_id?: string;
  model_name?: string;
  module?: string;
  duration_ms?: number;
  metadata?: Record<string, any>;
}

// 批量事件队列
const eventQueue: TrackEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL = 5000; // 5秒批量上报
const MAX_QUEUE_SIZE = 20;

function getSessionId(): string {
  let sid = sessionStorage.getItem("analytics_session_id");
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("analytics_session_id", sid);
  }
  return sid;
}

function getDeviceInfo() {
  return {
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
    platform: navigator.platform,
  };
}

async function flushEvents() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);
  try {
    await fetch("/api/analytics/track-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: batch.map((e) => ({
          ...e,
          page_path: e.page_path || window.location.pathname,
          session_id: getSessionId(),
          ...getDeviceInfo(),
        })),
      }),
      keepalive: true,
    });
  } catch {
    // 静默失败，不影响用户体验
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL);
}

export function trackEvent(payload: TrackEventPayload) {
  eventQueue.push(payload);
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushEvents();
  } else {
    scheduleFlush();
  }
}

// 页面访问追踪
export function usePageView() {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;

    trackEvent({
      event_type: "page_view",
      event_name: "page_view",
      page_path: window.location.pathname,
    });
  }, []);
}

// 聊天事件追踪
export function useChatAnalytics() {
  const startTimeRef = useRef<number>(0);

  const trackChatStart = useCallback((modelId?: string, modelName?: string) => {
    startTimeRef.current = Date.now();
    trackEvent({
      event_type: "chat_start",
      event_name: "chat_start",
      model_id: modelId,
      model_name: modelName,
    });
  }, []);

  const trackChatComplete = useCallback(
    (modelId?: string, modelName?: string, success = true) => {
      const duration = startTimeRef.current
        ? Date.now() - startTimeRef.current
        : 0;
      trackEvent({
        event_type: "chat_complete",
        event_name: success ? "chat_complete" : "chat_error",
        model_id: modelId,
        model_name: modelName,
        duration_ms: duration,
      });
    },
    []
  );

  const trackModelSwitch = useCallback(
    (fromModel: string, toModel: string) => {
      trackEvent({
        event_type: "model_switch",
        event_name: "model_switch",
        model_id: toModel,
        metadata: { from_model: fromModel },
      });
    },
    []
  );

  return { trackChatStart, trackChatComplete, trackModelSwitch };
}

// 积分使用追踪
export function trackCreditUse(amount: number, modelId?: string, modelName?: string) {
  trackEvent({
    event_type: "credit_use",
    event_name: "credit_use",
    model_id: modelId,
    model_name: modelName,
    metadata: { amount },
  });
}

// 功能使用追踪
export function trackFeatureUse(feature: string, metadata?: Record<string, any>) {
  trackEvent({
    event_type: "feature_use",
    event_name: feature,
    metadata,
  });
}

// 错误追踪
export function trackError(error: Error, context?: string) {
  trackEvent({
    event_type: "error",
    event_name: error.name || "error",
    metadata: {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      context,
    },
  });
}

// 页面停留时长追踪
export function usePageDuration() {
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();
    return () => {
      const duration = Date.now() - startTimeRef.current;
      if (duration > 3000) {
        // 只追踪停留超过3秒的页面
        trackEvent({
          event_type: "page_view",
          event_name: "page_duration",
          page_path: window.location.pathname,
          duration_ms: duration,
        });
      }
    };
  }, []);
}

// 全局错误监听
export function useGlobalErrorTracking() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      trackError(event.error || new Error(event.message), "global");
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);
}

// 页面卸载时刷新队列
export function useFlushOnUnload() {
  useEffect(() => {
    const handler = () => flushEvents();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}
