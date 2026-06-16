export type Tab = "workflow" | "image" | "video";
export type WorkflowMode = "novel" | "script" | "assets" | "storyboardVideo" | "storyboardImage";
export type WorkflowView = "overview" | "step";
export type AssetKind = "image" | "video" | "file";
export type AssetRole = "reference_image" | "first_frame" | "last_frame" | "reference_video" | "character" | "scene" | "prop" | "style";
export type SemanticAssetKind = "character" | "scene" | "prop" | "style";
export type ShotType = "远景" | "全景" | "中景" | "近景" | "特写" | "空镜" | "动作镜头";
export type CameraMove = "固定" | "推" | "拉" | "摇" | "移" | "跟" | "升降" | "手持" | "环绕";
export type ShotPurpose = "交代环境" | "建立关系" | "情绪爆发" | "动作衔接" | "信息揭示" | "悬念钩子" | "转场";
export type ShotStatus = "draft" | "image_generating" | "image_ready" | "video_generating" | "video_ready" | "failed";
export type GenerationJobStatus = "pending" | "succeeded" | "failed";
export type BatchMode = "missing" | "failed" | "all";
export type ScriptAssistantMode = "chat" | "rewrite";
export type AssetAssistantMode = "chat" | "rewrite";
export type AssetKindFilter = SemanticAssetKind | "all";

export type ScriptChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type StoredAsset = {
  id: string;
  publicId: string;
  name: string;
  type: AssetKind;
  mimeType?: string;
  size?: number;
  url: string;
  createdAt: string;
  role?: AssetRole;
  shotId?: string;
  source?: "upload" | "seedream" | "seedance" | "storyboard_sketch";
};

export type SemanticAsset = {
  id: string;
  kind: SemanticAssetKind;
  name: string;
  summary: string;
  lockPrompt: string;
  negativePrompt?: string;
  linkedAssetIds: string[];
  createdAt: string;
};

export type StoryboardShot = {
  id: string;
  index: number;
  title: string;
  scene: string;
  characters: string[];
  dialogue?: string;
  narration?: string;
  imagePrompt: string;
  videoPrompt: string;
  shotType: ShotType;
  cameraMove: CameraMove;
  purpose: ShotPurpose;
  duration: number;
  aspectRatio: string;
  status: ShotStatus;
  referenceAssetIds: string[];
  imageAssetIds: string[];
  videoAssetIds: string[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
  semanticAssetIds: string[];
};

export type GenerationJob = {
  id: string;
  shotId?: string;
  semanticAssetId?: string;
  type: "image" | "video";
  mediaId: number;
  prompt: string;
  status: GenerationJobStatus;
  intent?: "asset_image" | "shot_image" | "storyboard_sketch";
  createdAt: string;
  updatedAt: string;
};

export type SeedreamProject = {
  id: string;
  conversationId?: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  idea: string;
  novel: string;
  scriptSourceExcerpt: string;
  scriptAdaptationInstruction: string;
  script: string;
  assetsText: string;
  storyboardVideo: string;
  storyboardImage: string;
  assets: StoredAsset[];
  selectedAssetIds: string[];
  imagePrompt: string;
  videoPrompt: string;
  storyboardShots: StoryboardShot[];
  activeShotId?: string;
  generationJobs: GenerationJob[];
  semanticAssets: SemanticAsset[];
};
