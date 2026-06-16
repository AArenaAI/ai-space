import type { AssetRole, CameraMove, SemanticAssetKind, ShotPurpose, ShotType, WorkflowMode } from "./types";

export const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
export const IMAGE_RESOLUTIONS = ["2K"];
export const SEEDREAM_IMAGE_QUALITY = "medium";

export const VIDEO_MODELS = ["doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-pro-260128"];
export const VIDEO_ASPECTS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"];
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
export const VIDEO_DURATIONS = [5, 10, 15];
// Seedream Beta 文本工作流分层：DeepSeek 负责低成本剧本初稿，GPT 负责高质量精修/强钩子/对白重写。
export const WORKFLOW_DRAFT_MODEL = "deepseek-v4-pro";
export const WORKFLOW_POLISH_MODEL = "gpt-5.5";
export const WORKFLOW_MODEL = WORKFLOW_DRAFT_MODEL;

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
  { name: "沈青檀", role: "图一", src: "/seedream-beta/settings/shen-qingtan.png" },
  { name: "顾南舟", role: "图二", src: "/seedream-beta/settings/gu-nanzhou.png" },
  { name: "沈砚山", role: "图三", src: "/seedream-beta/settings/shen-yanshan.png" },
  { name: "陆衡", role: "图四", src: "/seedream-beta/settings/lu-heng.png" },
  { name: "洄州百姓 / 喜堂宾客群像", role: "图五", src: "/seedream-beta/settings/huizhou-guests.png" },
];
