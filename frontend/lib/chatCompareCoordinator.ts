export type CompareGroupContext = {
  groupId?: number;
  userMessageId?: number;
  groupModels: string[];
};

export type AvailableModelLike = {
  id: string;
};

export function selectCompareModelIds(
  requestedModelIds: string[],
  availableModels: AvailableModelLike[],
  maxModels: number = 2
): string[] {
  const available = new Set(availableModels.map((model) => model.id));
  return requestedModelIds.filter((id) => available.has(id)).slice(0, maxModels);
}

export function shouldStartCompare(compareModelIds: string[], minModels: number = 2): boolean {
  return compareModelIds.length >= minModels;
}

export function mergeCompareGroupContext({
  incoming,
  existing,
  fallbackGroupModels,
}: {
  incoming?: CompareGroupContext;
  existing?: CompareGroupContext;
  fallbackGroupModels: string[];
}): CompareGroupContext | undefined {
  if (!incoming) return existing;
  return {
    groupId: incoming.groupId || existing?.groupId,
    userMessageId: incoming.userMessageId || existing?.userMessageId,
    groupModels: incoming.groupModels.length > 0 ? incoming.groupModels : fallbackGroupModels,
  };
}

export function isCompareGroupContextReady(context?: CompareGroupContext): boolean {
  return !!context?.groupId && !!context.userMessageId;
}

export function getCompareRequestGroupContext({
  index,
  explicitContext,
  currentContext,
}: {
  index: number;
  explicitContext?: CompareGroupContext;
  currentContext?: CompareGroupContext;
}): CompareGroupContext | undefined {
  return explicitContext || (index === 0 ? undefined : currentContext);
}

export function shouldSkipSaveUserMessage(index: number): boolean {
  return index > 0;
}

export function resolveCompareRequestGroupModels({
  requestGroupModels,
  fallbackGroupModels,
}: {
  requestGroupModels?: string[];
  fallbackGroupModels: string[];
}): string[] {
  return requestGroupModels?.length ? requestGroupModels : fallbackGroupModels;
}
