export type NavigationAbortPlan = {
  shouldAbortMain: boolean;
  shouldAbortCompare: boolean;
  abortReason: "navigation" | null;
};

export type ConversationResetPlan = {
  kind: "reset";
  shouldSetLoadingHistory: boolean;
  loadingHistory: boolean;
  shouldClearConversationTitle: boolean;
  conversationTitle: string;
  shouldResetMessages: boolean;
  shouldSetCurrentConversation: boolean;
  currentConversation?: number;
  loadedPersistedMessages: number;
  totalMessages: number;
  isCompare: boolean;
  compareModels: string[];
  effectiveSkillKey?: string;
};

export type JustCreatedConversationPlan = {
  kind: "just_created";
  shouldClearJustCreated: boolean;
  conversationId: number;
  loadingHistory: boolean;
  loadedPersistedMessages: number;
  totalMessages: number;
};

export type ExistingConversationPlan = {
  kind: "load_existing";
  conversationId: number;
  abortPlan: NavigationAbortPlan;
  shouldSetLoadingHistory: boolean;
  loadingHistory: boolean;
  shouldSetCurrentConversation: boolean;
};

export type ConversationNavigationPlan =
  | ConversationResetPlan
  | JustCreatedConversationPlan
  | ExistingConversationPlan;

export type BuildConversationNavigationPlanInput = {
  conversationId?: number;
  shouldReset: boolean;
  justCreatedConversationId?: number;
  skillKey?: string;
  hasMainAbortController: boolean;
  compareAbortControllerCount: number;
};

export function buildNavigationAbortPlan(input: {
  hasMainAbortController: boolean;
  compareAbortControllerCount: number;
}): NavigationAbortPlan {
  const shouldAbortMain = input.hasMainAbortController;
  const shouldAbortCompare = input.compareAbortControllerCount > 0;
  return {
    shouldAbortMain,
    shouldAbortCompare,
    abortReason: shouldAbortMain || shouldAbortCompare ? "navigation" : null,
  };
}

export function buildConversationNavigationPlan(input: BuildConversationNavigationPlanInput): ConversationNavigationPlan {
  const {
    conversationId,
    shouldReset,
    justCreatedConversationId,
    skillKey,
    hasMainAbortController,
    compareAbortControllerCount,
  } = input;

  if (!conversationId) {
    return {
      kind: "reset",
      shouldSetLoadingHistory: true,
      loadingHistory: false,
      shouldClearConversationTitle: true,
      conversationTitle: "",
      shouldResetMessages: shouldReset,
      shouldSetCurrentConversation: shouldReset,
      currentConversation: undefined,
      loadedPersistedMessages: 0,
      totalMessages: 0,
      isCompare: false,
      compareModels: [],
      effectiveSkillKey: skillKey,
    };
  }

  if (justCreatedConversationId === conversationId) {
    return {
      kind: "just_created",
      shouldClearJustCreated: true,
      conversationId,
      loadingHistory: false,
      loadedPersistedMessages: 0,
      totalMessages: 0,
    };
  }

  return {
    kind: "load_existing",
    conversationId,
    abortPlan: buildNavigationAbortPlan({ hasMainAbortController, compareAbortControllerCount }),
    shouldSetLoadingHistory: true,
    loadingHistory: true,
    shouldSetCurrentConversation: true,
  };
}

export function shouldContinueConversationRestore(input: {
  token?: string | null;
  loadAborted: boolean;
}): boolean {
  return !input.loadAborted;
}
