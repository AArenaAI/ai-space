import type { EpisodeScript, SeedreamProject, StoredAsset } from "./types";
import { DEFAULT_WORKFLOW_MODELS, DEFAULT_WORKFLOW_MODEL_STRATEGY, WORKFLOW_MODEL_STRATEGIES } from "./constants";

export function createSeedreamProject(title: string, assets: StoredAsset[] = []): SeedreamProject {
  const now = new Date().toISOString();
  const id = `seedream-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    idea: "",
    flowStage: "idea",
    modelStrategy: DEFAULT_WORKFLOW_MODEL_STRATEGY,
    workflowModels: DEFAULT_WORKFLOW_MODELS,
    originalIdea: "",
    outlineSource: "",
    ideaSourceReference: "",
    ideaChatMessages: [],
    scriptSummary: {
      episodeCount: 5,
      genre: "",
      targetAudience: "大众",
      coreHook: "",
      logline: "",
      charactersText: "",
      synopsis: "",
    },
    episodeOutlines: [],
    episodeScripts: [],
    activeEpisode: 1,
    novel: "",
    scriptSourceExcerpt: "",
    scriptAdaptationInstruction: "",
    script: "",
    assetsText: "",
    storyboardVideo: "",
    storyboardImage: "",
    assets,
    selectedAssetIds: [],
    imagePrompt: "",
    videoPrompt: "",
    storyboardShots: [],
    activeShotId: undefined,
    generationJobs: [],
    semanticAssets: [],
  };
}

function normalizeEpisodeScript(script: any): EpisodeScript {
  const episode = Number(script?.episode || 1);
  return {
    episode,
    title: String(script?.title || `第${episode}集`),
    script: String(script?.script || ""),
    scenes: Array.isArray(script?.scenes) ? script.scenes : [],
    status: script?.status === "draft" || script?.status === "generating" || script?.status === "failed" ? script.status : "done",
  };
}

const IDEA_SOURCE_REFERENCE_MARKER = "【用户最后确认剧情原文】";

function splitIdeaSourceAndReference(value: string) {
  const source = (value || "").trim();
  const markerIndex = source.indexOf(IDEA_SOURCE_REFERENCE_MARKER);
  if (markerIndex < 0) return { outlineSource: source, ideaSourceReference: "" };
  return {
    outlineSource: source.slice(0, markerIndex).trim(),
    ideaSourceReference: source.slice(markerIndex + IDEA_SOURCE_REFERENCE_MARKER.length).trim(),
  };
}

export function normalizeProject(project: any): SeedreamProject {
  const base = createSeedreamProject(project?.title || "新项目");
  const assets = Array.isArray(project?.assets) ? project.assets.map((asset: any) => ({
    ...asset,
    role: asset.role || (asset.type === "video" ? "reference_video" : "reference_image"),
  })) : [];
  const semanticAssets = Array.isArray(project?.semanticAssets) ? project.semanticAssets.map((asset: any) => ({
    id: asset.id || `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: asset.kind || "character",
    name: asset.name || "未命名资产",
    summary: asset.summary || "",
    lockPrompt: asset.lockPrompt || asset.lock_prompt || asset.image_prompt || "",
    negativePrompt: asset.negativePrompt || asset.negative_prompt || "",
    linkedAssetIds: Array.isArray(asset.linkedAssetIds) ? asset.linkedAssetIds : [],
    createdAt: asset.createdAt || new Date().toISOString(),
  })) : [];
  const shots = Array.isArray(project?.storyboardShots) ? project.storyboardShots.map((shot: any, index: number) => ({
    id: shot.id || `shot-${Date.now()}-${index}`,
    episode: Number(shot.episode || project?.activeEpisode || 1),
    index: Number(shot.index || index + 1),
    title: shot.title || `镜头 ${index + 1}`,
    scene: shot.scene || "",
    characters: Array.isArray(shot.characters) ? shot.characters : String(shot.characters || "").split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
    dialogue: shot.dialogue || "",
    narration: shot.narration || "",
    imagePrompt: shot.imagePrompt || shot.image_prompt || "",
    videoPrompt: shot.videoPrompt || shot.video_prompt || "",
    shotType: shot.shotType || shot.shot_type || "中景",
    cameraMove: shot.cameraMove || shot.camera_move || "固定",
    purpose: shot.purpose || "信息揭示",
    duration: Number(shot.duration || 5),
    aspectRatio: shot.aspectRatio || shot.aspect_ratio || "9:16",
    status: shot.status || "draft",
    referenceAssetIds: Array.isArray(shot.referenceAssetIds) ? shot.referenceAssetIds : [],
    imageAssetIds: Array.isArray(shot.imageAssetIds) ? shot.imageAssetIds : [],
    videoAssetIds: Array.isArray(shot.videoAssetIds) ? shot.videoAssetIds : [],
    firstFrameAssetId: shot.firstFrameAssetId,
    lastFrameAssetId: shot.lastFrameAssetId,
    referenceVideoAssetId: shot.referenceVideoAssetId,
    semanticAssetIds: Array.isArray(shot.semanticAssetIds) ? shot.semanticAssetIds : [],
  })) : [];
  const storedModelStrategy = project?.modelStrategy;
  const baseModelStrategy: keyof typeof WORKFLOW_MODEL_STRATEGIES = storedModelStrategy === "economy" || storedModelStrategy === "balanced" || storedModelStrategy === "quality"
    ? storedModelStrategy
    : DEFAULT_WORKFLOW_MODEL_STRATEGY;
  const splitIdea = splitIdeaSourceAndReference(project?.outlineSource || "");
  return {
    ...base,
    ...project,
    conversationId: typeof project?.conversationId === "number" ? project.conversationId : typeof project?.conversation_id === "number" ? project.conversation_id : undefined,
    assets,
    selectedAssetIds: Array.isArray(project?.selectedAssetIds) ? project.selectedAssetIds : [],
    modelStrategy: project?.modelStrategy || DEFAULT_WORKFLOW_MODEL_STRATEGY,
    workflowModels: {
      ...WORKFLOW_MODEL_STRATEGIES[baseModelStrategy],
      ...(project?.workflowModels || {}),
    },
    flowStage: project?.flowStage || (project?.episodeScripts?.length ? "episodeScript" : project?.episodeOutlines?.length ? "outline" : project?.outlineSource ? "ideaContent" : "idea"),
    originalIdea: project?.originalIdea || project?.idea || project?.scriptSourceExcerpt || "",
    outlineSource: splitIdea.outlineSource || project?.originalIdea || project?.idea || project?.scriptSourceExcerpt || "",
    ideaSourceReference: project?.ideaSourceReference || splitIdea.ideaSourceReference || "",
    ideaChatMessages: Array.isArray(project?.ideaChatMessages) ? project.ideaChatMessages : [],
    scriptSummary: project?.scriptSummary || base.scriptSummary,
    episodeOutlines: Array.isArray(project?.episodeOutlines) ? project.episodeOutlines : [],
    episodeScripts: Array.isArray(project?.episodeScripts) ? project.episodeScripts.map(normalizeEpisodeScript) : [],
    activeEpisode: Number(project?.activeEpisode || 1),
    scriptSourceExcerpt: project?.scriptSourceExcerpt || project?.script_source_excerpt || "",
    scriptAdaptationInstruction: project?.scriptAdaptationInstruction || project?.script_adaptation_instruction || "",
    storyboardShots: shots,
    activeShotId: project?.activeShotId || shots[0]?.id,
    generationJobs: Array.isArray(project?.generationJobs) ? project.generationJobs : [],
    semanticAssets,
  };
}

export function getProjectPreview(project: SeedreamProject) {
  return project.novel || project.script || project.idea || project.storyboardVideo || project.assetsText || "";
}

export function formatProjectDate(value: string) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}
