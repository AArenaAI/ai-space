import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  buildConversationRestoreState,
  buildConversationStatusDecision,
  fetchConversationMessageCount,
  fetchConversationMessageStatus,
  fetchConversationRestore,
  findLastAssistantStatusTarget,
  parseConversationCompareModels,
  resolveConversationSkillKey,
} from "@/lib/chatConversationRestoreCoordinator";
import {
  buildConversationNavigationPlan,
  type ConversationResetPlan,
  type ExistingConversationPlan,
  type JustCreatedConversationPlan,
  shouldContinueConversationRestore,
} from "@/lib/chatNavigationResetCoordinator";
import { patchMessageById } from "@/lib/chatMessageStatePatch";
import {
  areConversationMessagesEquivalent,
  clearConversationSnapshotCache,
  getConversationSnapshot,
  invalidateConversationSnapshot,
  patchConversationSnapshot,
  setConversationSnapshot,
  type CachedConversationSnapshot,
} from "@/lib/chatConversationCache";
import {
  deletePersistentConversationSnapshot,
  getPersistentConversationSnapshot,
  setPersistentConversationSnapshot,
} from "@/lib/chatConversationPersistentCache";
import {
  createBusyGeneratingStatus,
  createGeneratingStatus,
} from "@/lib/chatActivityStatus";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { TaskStreamActiveState } from "@/hooks/useChatTaskStreamRuntime";

type AbortReason = "user" | "navigation" | null;

type ConversationSwitchPerformanceDetail = {
  conversationId?: number;
  loadSeq?: number;
  source?: "memory" | "indexeddb" | "backend" | "miss";
  durationMs?: number;
  messageCount?: number;
  totalMessages?: number;
};

function emitConversationSwitchPerformanceEvent(
  phase: string,
  detail: ConversationSwitchPerformanceDetail = {}
) {
  if (typeof window === "undefined") return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const eventDetail = { phase, at: now, ...detail };
  try {
    performance.mark?.(`chat-conversation-switch:${phase}`);
  } catch {}
  window.dispatchEvent(new CustomEvent("chat-conversation-switch-performance", { detail: eventDetail }));
}

type StartTaskEventStream = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number,
  after?: number,
  initialContent?: string,
  generationTaskId?: number
) => void;

type ApplyCachedSnapshotOptions = {
  snapshot: CachedConversationSnapshot;
  fallbackSkillKey?: string;
  models: ChatModel[];
  setConversationTitle: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
  setSelectedModel: (model: ChatModel) => void;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  setEffectiveSkillKey: Dispatch<SetStateAction<string | undefined>>;
  setIsLoadingHistory: Dispatch<SetStateAction<boolean>>;
};

function applyCachedSnapshot({
  snapshot,
  fallbackSkillKey,
  models,
  setConversationTitle,
  setMessages,
  setLoadedPersistedMessages,
  setGroupViews,
  setIsLoading,
  setTotalMessages,
  setSelectedModel,
  setIsCompare,
  setCompareModels,
  setEffectiveSkillKey,
  setIsLoadingHistory,
}: ApplyCachedSnapshotOptions) {
  setConversationTitle(snapshot.title || "");
  setMessages(snapshot.messages);
  setLoadedPersistedMessages(snapshot.loadedPersistedMessages);
  setGroupViews(snapshot.groupViews);
  setIsLoading(snapshot.isLoading);
  if (typeof snapshot.totalMessages === "number") {
    setTotalMessages(snapshot.totalMessages);
  }
  if (snapshot.model) {
    const model = models.find((m) => m.id === snapshot.model);
    if (model) setSelectedModel(model);
  }
  setIsCompare(snapshot.isCompare);
  setCompareModels(snapshot.compareModels);
  setEffectiveSkillKey(snapshot.skillKey ?? fallbackSkillKey);
  setIsLoadingHistory(false);
}

export type UseChatConversationRestoreRuntimeOptions = {
  apiBaseUrl: string;
  conversationId: number | undefined;
  models: ChatModel[];
  modelsKey: string;
  skillKey: string | undefined;
  conversationLoadSeqRef: MutableRefObject<number>;
  shouldResetRef: MutableRefObject<boolean>;
  justCreatedRef: MutableRefObject<number | undefined>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  compareAbortControllersRef: MutableRefObject<AbortController[]>;
  abortReasonRef: MutableRefObject<AbortReason>;
  activeTaskStreamsRef: MutableRefObject<Record<string, TaskStreamActiveState>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setConversationTitle: Dispatch<SetStateAction<string>>;
  setLoadedPersistedMessages: Dispatch<SetStateAction<number>>;
  setGroupViews: Dispatch<SetStateAction<Map<number, number>>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsLoadingHistory: Dispatch<SetStateAction<boolean>>;
  setTotalMessages: Dispatch<SetStateAction<number>>;
  setSelectedModel: (model: ChatModel) => void;
  setIsCompare: Dispatch<SetStateAction<boolean>>;
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  setEffectiveSkillKey: Dispatch<SetStateAction<string | undefined>>;
  applyNavigationResetLifecycle: (plan: ConversationResetPlan) => void;
  applyJustCreatedNavigationLifecycle: (plan: JustCreatedConversationPlan) => void;
  applyLoadExistingNavigationLifecycle: (plan: ExistingConversationPlan) => void;
  startTaskEventStream: StartTaskEventStream;
  translate: (key: string) => string;
  getToken?: () => string | null;
  createId?: () => string;
  fetchRestore?: typeof fetchConversationRestore;
  fetchMessageStatus?: typeof fetchConversationMessageStatus;
  fetchMessageCount?: typeof fetchConversationMessageCount;
};

export function useChatConversationRestoreRuntime({
  apiBaseUrl,
  conversationId,
  models,
  modelsKey,
  skillKey,
  conversationLoadSeqRef,
  shouldResetRef,
  justCreatedRef,
  abortControllerRef,
  compareAbortControllersRef,
  abortReasonRef,
  activeTaskStreamsRef,
  setMessages,
  setConversationTitle,
  setLoadedPersistedMessages,
  setGroupViews,
  setIsLoading,
  setIsLoadingHistory,
  setTotalMessages,
  setSelectedModel,
  setIsCompare,
  setCompareModels,
  setEffectiveSkillKey,
  applyNavigationResetLifecycle,
  applyJustCreatedNavigationLifecycle,
  applyLoadExistingNavigationLifecycle,
  startTaskEventStream,
  translate,
  getToken = () => localStorage.getItem("token"),
  createId = uuidv4,
  fetchRestore = fetchConversationRestore,
  fetchMessageStatus = fetchConversationMessageStatus,
  fetchMessageCount = fetchConversationMessageCount,
}: UseChatConversationRestoreRuntimeOptions) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleTestControl = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "clear-memory-cache") clearConversationSnapshotCache();
    };
    window.addEventListener("chat-conversation-switch-test-control", handleTestControl);
    return () => window.removeEventListener("chat-conversation-switch-test-control", handleTestControl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleConversationUpdated = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: number | string }>).detail?.conversationId;
      const normalized = typeof conversationId === "string" ? Number(conversationId) : conversationId;
      if (typeof normalized === "number" && Number.isFinite(normalized)) {
        invalidateConversationSnapshot(normalized);
        deletePersistentConversationSnapshot(normalized);
      }
    };
    window.addEventListener("conversation-updated", handleConversationUpdated);
    return () => window.removeEventListener("conversation-updated", handleConversationUpdated);
  }, []);

  useEffect(() => {
    const loadSeq = ++conversationLoadSeqRef.current;
    const loadController = new AbortController();
    const switchStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedSinceSwitchStart = () =>
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - switchStartedAt;
    const isLatestLoad = () => conversationLoadSeqRef.current === loadSeq;

    const navigationPlan = buildConversationNavigationPlan({
      conversationId,
      shouldReset: shouldResetRef.current,
      justCreatedConversationId: justCreatedRef.current ?? undefined,
      skillKey,
      hasMainAbortController: Boolean(abortControllerRef.current),
      compareAbortControllerCount: compareAbortControllersRef.current.length,
    });

    if (navigationPlan.kind === "reset") {
      if (navigationPlan.shouldSetLoadingHistory) setIsLoadingHistory(navigationPlan.loadingHistory);
      applyNavigationResetLifecycle(navigationPlan);
      if (navigationPlan.shouldResetMessages) setMessages([]);
      setIsCompare(navigationPlan.isCompare);
      setCompareModels(navigationPlan.compareModels);
      setEffectiveSkillKey(navigationPlan.effectiveSkillKey);
      return () => loadController.abort();
    }

    if (navigationPlan.kind === "just_created") {
      applyJustCreatedNavigationLifecycle(navigationPlan);
      setIsLoadingHistory(navigationPlan.loadingHistory);
      return () => loadController.abort();
    }

    const { abortPlan } = navigationPlan;
    if (abortPlan.shouldAbortMain && abortControllerRef.current) {
      abortReasonRef.current = abortPlan.abortReason;
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (abortPlan.shouldAbortCompare && compareAbortControllersRef.current.length > 0) {
      abortReasonRef.current = abortPlan.abortReason;
      compareAbortControllersRef.current.forEach((controller) => controller.abort());
      compareAbortControllersRef.current = [];
    }

    const activeEntries = Object.entries(activeTaskStreamsRef.current);

    const token = getToken();
    if (!shouldContinueConversationRestore({ token, loadAborted: loadController.signal.aborted })) {
      setIsLoadingHistory(false);
      return () => loadController.abort();
    }
    const loadConversationId: number = navigationPlan.conversationId;
    const authToken: string = token as string;
    emitConversationSwitchPerformanceEvent("start", { conversationId: loadConversationId, loadSeq });

    if (navigationPlan.shouldSetLoadingHistory) setIsLoadingHistory(navigationPlan.loadingHistory);
    applyLoadExistingNavigationLifecycle(navigationPlan);

    const cachedSnapshot = getConversationSnapshot(loadConversationId);
    let hasDisplayedSnapshot = false;
    let displayedSnapshotVersion: string | undefined = cachedSnapshot?.snapshotVersion;
    let persistentSnapshotReady: Promise<void> = Promise.resolve();
    if (cachedSnapshot) {
      hasDisplayedSnapshot = true;
      emitConversationSwitchPerformanceEvent("first-snapshot", {
        conversationId: loadConversationId,
        loadSeq,
        source: "memory",
        durationMs: elapsedSinceSwitchStart(),
        messageCount: cachedSnapshot.messages.length,
        totalMessages: cachedSnapshot.totalMessages,
      });
      applyCachedSnapshot({
        snapshot: cachedSnapshot,
        fallbackSkillKey: skillKey,
        models,
        setConversationTitle,
        setMessages,
        setLoadedPersistedMessages,
        setGroupViews,
        setIsLoading,
        setTotalMessages,
        setSelectedModel,
        setIsCompare,
        setCompareModels,
        setEffectiveSkillKey,
        setIsLoadingHistory,
      });
    } else {
      emitConversationSwitchPerformanceEvent("cache-miss", {
        conversationId: loadConversationId,
        loadSeq,
        source: "miss",
        durationMs: elapsedSinceSwitchStart(),
      });
      setMessages([]);
      setLoadedPersistedMessages(0);
      setGroupViews(new Map());
      setIsLoading(false);
      persistentSnapshotReady = getPersistentConversationSnapshot(loadConversationId)
        .then((persistentSnapshot) => {
          if (!persistentSnapshot || !isLatestLoad() || loadController.signal.aborted || hasDisplayedSnapshot) return;
          hasDisplayedSnapshot = true;
          displayedSnapshotVersion = persistentSnapshot.snapshotVersion;
          emitConversationSwitchPerformanceEvent("first-snapshot", {
            conversationId: loadConversationId,
            loadSeq,
            source: "indexeddb",
            durationMs: elapsedSinceSwitchStart(),
            messageCount: persistentSnapshot.messages.length,
            totalMessages: persistentSnapshot.totalMessages,
          });
          applyCachedSnapshot({
            snapshot: persistentSnapshot,
            fallbackSkillKey: skillKey,
            models,
            setConversationTitle,
            setMessages,
            setLoadedPersistedMessages,
            setGroupViews,
            setIsLoading,
            setTotalMessages,
            setSelectedModel,
            setIsCompare,
            setCompareModels,
            setEffectiveSkillKey,
            setIsLoadingHistory,
          });
        })
        .catch(() => {});
    }

    let resolvedTotalMessages: number | undefined = cachedSnapshot?.totalMessages;
    const applyTotalMessages = (total: number, source: "backend" | "miss" = "backend") => {
      resolvedTotalMessages = total;
      emitConversationSwitchPerformanceEvent("message-count", {
        conversationId: loadConversationId,
        loadSeq,
        source,
        durationMs: elapsedSinceSwitchStart(),
        totalMessages: total,
      });
      setTotalMessages(total);
      patchConversationSnapshot(loadConversationId, { totalMessages: total });
    };

    persistentSnapshotReady
      .then(() => fetchRestore({
        apiBaseUrl,
        conversationId: loadConversationId,
        token: authToken,
        signal: loadController.signal,
        snapshotVersion: displayedSnapshotVersion,
      }))
      .then((data) => {
        if (!isLatestLoad() || loadController.signal.aborted) return;
        if (data.notModified) {
          emitConversationSwitchPerformanceEvent("restore-not-modified", {
            conversationId: loadConversationId,
            loadSeq,
            source: "backend",
            durationMs: elapsedSinceSwitchStart(),
          });
          setIsLoadingHistory(false);
          return;
        }
        emitConversationSwitchPerformanceEvent("restore-response", {
          conversationId: loadConversationId,
          loadSeq,
          source: "backend",
          durationMs: elapsedSinceSwitchStart(),
          messageCount: Array.isArray(data.messages) ? data.messages.length : undefined,
        });
        if (typeof data.total === "number") {
          applyTotalMessages(data.total);
        } else {
          fetchMessageCount({
            apiBaseUrl,
            conversationId: loadConversationId,
            token: authToken,
            signal: loadController.signal,
          })
            .then((total) => {
              if (typeof total === "number" && isLatestLoad() && !loadController.signal.aborted) {
                applyTotalMessages(total);
              }
            })
            .catch(() => {});
        }
        setConversationTitle(data.title || "");
        const restoreState = buildConversationRestoreState({
          data,
          activeEntries,
          conversationId: loadConversationId,
          fallbackId: createId,
          activeActivityStatus: createGeneratingStatus(translate),
        });
        if (restoreState) {
          const { loadedMessages, mergedMessages, groupViews, activeByServerMessageId } = restoreState;
          if (!hasDisplayedSnapshot) {
            hasDisplayedSnapshot = true;
            emitConversationSwitchPerformanceEvent("first-snapshot", {
              conversationId: loadConversationId,
              loadSeq,
              source: "backend",
              durationMs: elapsedSinceSwitchStart(),
              messageCount: (mergedMessages as Message[]).length,
              totalMessages: resolvedTotalMessages,
            });
          }
          setMessages((prev) =>
            areConversationMessagesEquivalent(prev, mergedMessages as Message[]) ? prev : (mergedMessages as Message[])
          );
          setLoadedPersistedMessages(loadedMessages.length);
          setGroupViews(groupViews);
          setIsLoading(restoreState.isLoading);
          const snapshot: CachedConversationSnapshot = {
            conversationId: loadConversationId,
            title: data.title || "",
            messages: mergedMessages as Message[],
            loadedPersistedMessages: loadedMessages.length,
            totalMessages: resolvedTotalMessages,
            groupViews,
            isLoading: restoreState.isLoading,
            isCompare: !!data.compare,
            compareModels: parseConversationCompareModels(data.compare_models),
            model: data.model,
            skillKey: resolveConversationSkillKey(data.skill_key, skillKey),
            snapshotVersion: data.snapshot_version,
            fetchedAt: Date.now(),
            updatedAt: Date.now(),
          };
          setConversationSnapshot(snapshot);
          setPersistentConversationSnapshot(snapshot);
          emitConversationSwitchPerformanceEvent("restore-reconciled", {
            conversationId: loadConversationId,
            loadSeq,
            source: "backend",
            durationMs: elapsedSinceSwitchStart(),
            messageCount: (mergedMessages as Message[]).length,
            totalMessages: resolvedTotalMessages,
          });

          const lastAssistant = findLastAssistantStatusTarget(mergedMessages, activeByServerMessageId);
          const applyStatusData = (statusData: NonNullable<typeof data.last_assistant_status>) => {
            if (!lastAssistant || !isLatestLoad() || loadController.signal.aborted) return;
            emitConversationSwitchPerformanceEvent("message-status", {
              conversationId: loadConversationId,
              loadSeq,
              source: "backend",
              durationMs: elapsedSinceSwitchStart(),
            });
            const decision = buildConversationStatusDecision({
              statusData,
              currentMessage: lastAssistant,
              busyActivityStatus: createBusyGeneratingStatus(translate),
            });

            setMessages((prev) => patchMessageById(prev, lastAssistant.id, decision.patch as Partial<Message>));

            if (decision.shouldResumePolling && decision.resume) {
              setIsLoading(true);
              startTaskEventStream(
                loadConversationId,
                lastAssistant.id,
                lastAssistant.serverMessageId,
                decision.resume.lastSequence,
                decision.resume.initialContent,
                decision.resume.generationTaskId
              );
            }
          };
          if (lastAssistant?.serverMessageId) {
            if (data.last_assistant_status) {
              applyStatusData(data.last_assistant_status);
            } else {
              fetchMessageStatus({
                apiBaseUrl,
                conversationId: loadConversationId,
                serverMessageId: lastAssistant.serverMessageId,
                token: authToken,
                signal: loadController.signal,
              })
                .then((statusData) => {
                  if (statusData) applyStatusData(statusData);
                })
                .catch((err: any) => {
                  if (loadController.signal.aborted || err?.name === "AbortError") return;
                });
            }
          }
        } else {
          setMessages([]);
          setLoadedPersistedMessages(0);
          setIsLoading(false);
          invalidateConversationSnapshot(loadConversationId);
          deletePersistentConversationSnapshot(loadConversationId);
        }
        setIsLoadingHistory(false);

        if (data.model) {
          const model = models.find((m) => m.id === data.model);
          if (model) setSelectedModel(model);
        }
        setIsCompare(!!data.compare);
        setCompareModels(parseConversationCompareModels(data.compare_models));
        setEffectiveSkillKey(resolveConversationSkillKey(data.skill_key, skillKey));
      })
      .catch((err) => {
        if (!isLatestLoad() || loadController.signal.aborted || err?.name === "AbortError") return;
        setMessages([]);
        setIsLoadingHistory(false);
      });

    return () => loadController.abort();
  }, [conversationId, modelsKey, setSelectedModel, skillKey]);
}
