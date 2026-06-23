import type { AssetRole, CameraMove, SemanticAssetKind, ShotPurpose, ShotType, WorkflowMode, WorkflowModelConfig, WorkflowModelStrategy, WorkflowModelTask } from "./types";

export const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
export const IMAGE_RESOLUTIONS = ["2K"];
export const SEEDREAM_IMAGE_QUALITY = "medium";

export const VIDEO_MODELS = [
  // Match backend .env default / currently accessible Ark endpoint first.
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-260128",
  // Newer display IDs are kept for environments that have explicit access.
  "doubao-seedance-2.0-mini",
  "doubao-seedance-1.5-pro",
  "doubao-seedance-1.0-pro",
  "doubao-seedance-1.0-pro-fast",
];
export const VIDEO_ASPECTS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"];
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
export const VIDEO_DURATIONS = [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function normalizeModelId(model?: string) {
  return (model || "").toLowerCase().replace(/[._]/g, "-");
}

function isSeedance1(model?: string) {
  return normalizeModelId(model).includes("seedance-1-0");
}

function isSeedance15(model?: string) {
  return normalizeModelId(model).includes("seedance-1-5");
}

function isSeedance2(model?: string) {
  return normalizeModelId(model).includes("seedance-2-0");
}

function isFastLikeSeedance(model?: string) {
  const normalized = normalizeModelId(model);
  return normalized.includes("seedance-2-0-fast") || normalized.includes("seedance-2-0-mini") || normalized.includes("seedance-1-0-pro-fast");
}

export function getVideoDurationOptions(model?: string) {
  if (isSeedance1(model)) return range(2, 12);
  if (isSeedance15(model)) return [-1, ...range(4, 12)];
  if (isSeedance2(model)) return [-1, ...range(4, 15)];
  return VIDEO_DURATIONS;
}

export function getVideoResolutionOptions(model?: string) {
  return isFastLikeSeedance(model) ? ["480p", "720p"] : VIDEO_RESOLUTIONS;
}

export function normalizeVideoDurationForModel(model: string | undefined, duration?: number) {
  const options = getVideoDurationOptions(model);
  const fallback = options.includes(5) ? 5 : options[0];
  const raw = Number(duration ?? fallback);
  if (options.includes(raw)) return raw;
  const numericOptions = options.filter((item) => item > 0);
  return numericOptions.reduce((best, item) => Math.abs(item - raw) < Math.abs(best - raw) ? item : best, numericOptions[0] || fallback);
}

export function normalizeVideoResolutionForModel(model: string | undefined, resolution?: string) {
  const options = getVideoResolutionOptions(model);
  const raw = resolution || "720p";
  return options.includes(raw) ? raw : "720p";
}
// AI 漫剧 文本工作流分层：DeepSeek 负责低成本剧本初稿，GPT 负责高质量精修/强钩子/对白重写。
export const WORKFLOW_DRAFT_MODEL = "deepseek-v4-pro";
export const WORKFLOW_POLISH_MODEL = "gpt-5.5";
export const WORKFLOW_MODEL = WORKFLOW_DRAFT_MODEL;
export const WORKFLOW_MODEL_OPTIONS = [
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", cost: "低成本", hint: "适合批量正文/资产/分镜提示词" },
  { value: "gpt-5.5", label: "GPT-5.5", cost: "高质量", hint: "适合聊剧本/改剧本/强钩子" },
] as const;
export const WORKFLOW_MODEL_TASKS: Array<{ key: WorkflowModelTask; label: string; desc: string }> = [
  { key: "ideaChat", label: "AI聊剧本", desc: "追问创意、钩子、人物关系" },
  { key: "ideaExtract", label: "提炼创意内容", desc: "最终有效创意/剧情母版" },
  { key: "outline", label: "生成大纲", desc: "剧本摘要与分集结构" },
  { key: "episodeScript", label: "分集正文", desc: "批量写每集正文" },
  { key: "scriptRewrite", label: "一键改剧本", desc: "对白、节奏、钩子重写" },
  { key: "assetExtract", label: "生成资产", desc: "角色/场景/道具/风格" },
  { key: "storyboardVideoPrompt", label: "视频分镜提示词", desc: "Seedance 可投喂文本" },
  { key: "storyboardImagePrompt", label: "分镜图提示词", desc: "Seedream 静态分镜图" },
];
export const WORKFLOW_MODEL_STRATEGY_LABELS: Record<WorkflowModelStrategy, string> = {
  economy: "省钱",
  balanced: "平衡",
  quality: "高质量",
  custom: "自定义",
};
export const WORKFLOW_MODEL_STRATEGIES: Record<Exclude<WorkflowModelStrategy, "custom">, WorkflowModelConfig> = {
  economy: {
    ideaChat: WORKFLOW_DRAFT_MODEL,
    ideaExtract: WORKFLOW_DRAFT_MODEL,
    outline: WORKFLOW_DRAFT_MODEL,
    episodeScript: WORKFLOW_DRAFT_MODEL,
    scriptRewrite: WORKFLOW_DRAFT_MODEL,
    assetExtract: WORKFLOW_DRAFT_MODEL,
    storyboardVideoPrompt: WORKFLOW_DRAFT_MODEL,
    storyboardImagePrompt: WORKFLOW_DRAFT_MODEL,
  },
  balanced: {
    ideaChat: WORKFLOW_POLISH_MODEL,
    ideaExtract: WORKFLOW_POLISH_MODEL,
    outline: WORKFLOW_POLISH_MODEL,
    episodeScript: WORKFLOW_DRAFT_MODEL,
    scriptRewrite: WORKFLOW_POLISH_MODEL,
    assetExtract: WORKFLOW_DRAFT_MODEL,
    storyboardVideoPrompt: WORKFLOW_DRAFT_MODEL,
    storyboardImagePrompt: WORKFLOW_DRAFT_MODEL,
  },
  quality: {
    ideaChat: WORKFLOW_POLISH_MODEL,
    ideaExtract: WORKFLOW_POLISH_MODEL,
    outline: WORKFLOW_POLISH_MODEL,
    episodeScript: WORKFLOW_POLISH_MODEL,
    scriptRewrite: WORKFLOW_POLISH_MODEL,
    assetExtract: WORKFLOW_POLISH_MODEL,
    storyboardVideoPrompt: WORKFLOW_POLISH_MODEL,
    storyboardImagePrompt: WORKFLOW_POLISH_MODEL,
  },
};
export const DEFAULT_WORKFLOW_MODEL_STRATEGY: WorkflowModelStrategy = "balanced";
export const DEFAULT_WORKFLOW_MODELS: WorkflowModelConfig = WORKFLOW_MODEL_STRATEGIES[DEFAULT_WORKFLOW_MODEL_STRATEGY];

export const ASSET_STORAGE_KEY = "seedream-beta-assets-v1";
export const PROJECTS_STORAGE_KEY = "seedream-beta-projects-v1";
export const ACTIVE_PROJECT_STORAGE_KEY = "seedream-beta-active-project-id";
export const SHOT_IMPORT_INPUT_ID = "seedream-beta-project-import";

export const ASSET_ROLE_OPTIONS: Array<{ value: AssetRole; label: string }> = [
  { value: "reference_image", label: "参考图" },
  { value: "first_frame", label: "首帧" },
  { value: "last_frame", label: "尾帧" },
  { value: "reference_video", label: "参考视频" },
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "prop", label: "道具" },
  { value: "style", label: "风格" },
];

export const VIDEO_REFERENCE_ROLES = new Set<AssetRole>(["reference_image", "first_frame", "last_frame", "character", "scene", "prop", "style"]);
export const SHOT_TYPES: ShotType[] = ["远景", "全景", "中景", "近景", "特写", "空镜", "动作镜头"];
export const CAMERA_MOVES: CameraMove[] = ["固定", "推", "拉", "摇", "移", "跟", "升降", "手持", "环绕"];
export const SHOT_PURPOSES: ShotPurpose[] = ["交代环境", "建立关系", "情绪爆发", "动作衔接", "信息揭示", "悬念钩子", "转场"];
export const SEMANTIC_ASSET_KINDS: Array<{ value: SemanticAssetKind; label: string }> = [
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "prop", label: "道具" },
  { value: "style", label: "风格" },
];

export const WORKFLOW_STEPS: Array<{ id: WorkflowMode; titleKey: string; descKey: string; buttonKey: string; placeholderKey: string }> = [
  { id: "script", titleKey: "seedreamBeta.workflow.scriptTitle", descKey: "seedreamBeta.workflow.scriptDesc", buttonKey: "seedreamBeta.workflow.generateScript", placeholderKey: "seedreamBeta.workflow.scriptPlaceholder" },
  { id: "assets", titleKey: "seedreamBeta.workflow.assetsTitle", descKey: "seedreamBeta.workflow.assetsDesc", buttonKey: "seedreamBeta.workflow.generateAssets", placeholderKey: "seedreamBeta.workflow.assetsPlaceholder" },
  { id: "storyboardVideo", titleKey: "seedreamBeta.workflow.storyboardVideoTitle", descKey: "seedreamBeta.workflow.storyboardVideoDesc", buttonKey: "seedreamBeta.workflow.generateStoryboardVideo", placeholderKey: "seedreamBeta.workflow.storyboardVideoPlaceholder" },
  { id: "storyboardImage", titleKey: "seedreamBeta.workflow.storyboardImageTitle", descKey: "seedreamBeta.workflow.storyboardImageDesc", buttonKey: "seedreamBeta.workflow.generateStoryboardImage", placeholderKey: "seedreamBeta.workflow.storyboardImagePlaceholder" },
];

export const SETTING_BOARD_IMAGES = [
  { name: "沈青檀", role: "图一", src: "/ai-comic/settings/shen-qingtan.png" },
  { name: "顾南舟", role: "图二", src: "/ai-comic/settings/gu-nanzhou.png" },
  { name: "沈砚山", role: "图三", src: "/ai-comic/settings/shen-yanshan.png" },
  { name: "陆衡", role: "图四", src: "/ai-comic/settings/lu-heng.png" },
  { name: "洄州百姓 / 喜堂宾客群像", role: "图五", src: "/ai-comic/settings/huizhou-guests.png" },
];
