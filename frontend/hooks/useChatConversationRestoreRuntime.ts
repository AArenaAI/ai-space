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
  createBusyGeneratingStatus,
  createGeneratingStatus,
} from "@/lib/chatActivityStatus";
import type { ChatModel, Message } from "@/lib/chatTypes";
import type { TaskStreamActiveState } from "@/hooks/useChatTaskStreamRuntime";

type AbortReason = "user" | "navigation" | null;
type StartTaskEventStream = (
  convId: number | undefined,
  localMessageId: string,
  serverMessageId?: number,
  after?: number,
  initialContent?: string,
  generationTaskId?: number
) => void;

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
}: UseChatConversationRestoreRuntimeOptions) {
  useEffect(() => {
    const loadSeq = ++conversationLoadSeqRef.current;
    const loadController = new AbortController();
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

    if (navigationPlan.shouldSetLoadingHistory) setIsLoadingHistory(navigationPlan.loadingHistory);
    applyLoadExistingNavigationLifecycle(navigationPlan);

    fetchConversationRestore({
      apiBaseUrl,
      conversationId: loadConversationId,
      token: authToken,
      signal: loadController.signal,
    })
      .then((data) => {
        if (!isLatestLoad() || loadController.signal.aborted) return;
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
          setMessages(mergedMessages as Message[]);
          setLoadedPersistedMessages(loadedMessages.length);
          setGroupViews(groupViews);
          setIsLoading(restoreState.isLoading);

          const lastAssistant = findLastAssistantStatusTarget(mergedMessages, activeByServerMessageId);
          if (lastAssistant?.serverMessageId) {
            fetchConversationMessageStatus({
              apiBaseUrl,
              conversationId: loadConversationId,
              serverMessageId: lastAssistant.serverMessageId,
              token: authToken,
              signal: loadController.signal,
            })
              .then((statusData) => {
                if (!statusData || !isLatestLoad() || loadController.signal.aborted) return;
                const decision = buildConversationStatusDecision({
                  statusData,
                  currentMessage: lastAssistant,
                  busyActivityStatus: createBusyGeneratingStatus(translate),
                });

                setMessages((prev) => patchMessageById(prev, lastAssistant.id, decision.patch as Partial<Message>));

                if (decision.shouldResumePolling && decision.resume) {
                  setIsLoading(true);
                  startTaskEventStream(
                    conversationId,
                    lastAssistant.id,
                    lastAssistant.serverMessageId,
                    decision.resume.lastSequence,
                    decision.resume.initialContent,
                    decision.resume.generationTaskId
                  );
                }
              })
              .catch((err: any) => {
                if (loadController.signal.aborted || err?.name === "AbortError") return;
              });
          }
        } else {
          setMessages([]);
          setLoadedPersistedMessages(0);
          setIsLoading(false);
        }
        setIsLoadingHistory(false);

        fetchConversationMessageCount({
          apiBaseUrl,
          conversationId: loadConversationId,
          token: authToken,
          signal: loadController.signal,
        })
          .then((total) => {
            if (typeof total === "number") {
              setTotalMessages(total);
            }
          })
          .catch(() => {});

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
