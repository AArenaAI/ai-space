export type Tab = "workflow" | "image" | "video";
export type WorkflowMode = "novel" | "script" | "assets" | "storyboardVideo" | "storyboardImage" | "videoSegments";
export type GeneratorGroupMode = "image" | "video";
export type WorkflowView = "overview" | "step" | "videoSegments" | "assets" | "script";
export type StoryFlowStage = "idea" | "ideaContent" | "outline" | "episodeScript" | "canvas";
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
export type WorkflowModelStrategy = "economy" | "balanced" | "quality" | "custom";
export type WorkflowModelTask = "ideaChat" | "ideaExtract" | "outline" | "episodeScript" | "scriptRewrite" | "assetExtract" | "storyboardVideoPrompt" | "storyboardImagePrompt";
export type WorkflowModelConfig = Record<WorkflowModelTask, string>;

export type GenerationAction = {
  action: "image.generate" | "image.edit" | "video.generate" | "video.extend" | string;
  actionInput: string;
  supplementary?: Record<string, unknown>;
};

export type ScriptChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type ScriptSummary = {
  episodeCount: number;
  genre: string;
  targetAudience: string;
  coreHook: string;
  logline: string;
  charactersText: string;
  synopsis: string;
};

export type EpisodeOutline = {
  episode: number;
  title: string;
  summary: string;
};

export type EpisodeScriptDialogue = {
  character: string;
  text: string;
  tone?: string;
};

export type EpisodeScriptScene = {
  scene: number;
  title?: string;
  location: string;
  time: string;
  characters: string[];
  visualAction: string;
  dialogue: EpisodeScriptDialogue[];
  narration?: string;
  emotion?: string;
  hook?: string;
};

export type EpisodeScript = {
  episode: number;
  title: string;
  script: string;
  scenes?: EpisodeScriptScene[];
  status: "draft" | "generating" | "done" | "failed";
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
  imageUrl?: string; // 已生成的资产图
  imageAssetId?: string; // 关联的存储资产ID
};

export type VideoSegment = {
  id: string;
  index: number;
  title: string;
  shots: StoryboardShot[];
  lastFrameShotId?: string; // 用于尾帧衔接
  status: "draft" | "generating" | "done" | "failed";
};

export type StoryboardShot = {
  id: string;
  episode?: number;
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
  errorMessage?: string;
  referenceAssetIds: string[];
  imageAssetIds: string[];
  videoAssetIds: string[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
  semanticAssetIds: string[];
  generationActions?: {
    storyboardImage?: GenerationAction;
    shotVideo?: GenerationAction;
    [key: string]: GenerationAction | undefined;
  };
};

export type GenerationJob = {
  id: string;
  shotId?: string;
  semanticAssetId?: string;
  type: "image" | "video";
  mediaId: number;
  prompt: string;
  status: GenerationJobStatus;
  canvasNodeId?: string;
  intent?: "asset_image" | "shot_image" | "storyboard_sketch" | "canvas_image";
  entryPath?: "single" | "batch" | "asset" | "canvas";
  promptSource?: "assetPrompt" | "storyboardSketch" | "imagePrompt" | "structuredFallback" | "videoPrompt" | "imagePromptFallback" | "canvasPrompt";
  directorInjected?: boolean;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  createdAt: string;
  updatedAt: string;
};

// ===== 导演台 (Director Block) =====
export type Facing = "left" | "right" | "front" | "back" | "front-left" | "front-right" | "back-left" | "back-right";
export type PosePreset = "standing" | "sitting" | "walking" | "running" | "fighting" | "crouching" | "kneeling" | "pointing" | "holding" | "custom";

export type CharacterBlock = {
  id: string;
  semanticAssetId: string; // 关联语义资产
  x: number; // 0-1 画布坐标
  y: number; // 0-1 画布坐标
  facing: Facing;
  heightRatio: number; // 0-1，占画面高度比例
  pose: PosePreset;
  poseDescription?: string; // 自定义姿势描述
  zIndex?: number; // 层级，用于前后关系
  visible?: boolean; // 是否在当前镜头可见
  // 姿势参考图（用于角色一致性）
  poseRefAssetId?: string;
  // 骨骼关键点（可选，用于精确姿势控制）
  skeleton?: {
    head: { x: number; y: number };
    neck: { x: number; y: number };
    leftShoulder: { x: number; y: number };
    rightShoulder: { x: number; y: number };
    leftElbow: { x: number; y: number };
    rightElbow: { x: number; y: number };
    leftWrist: { x: number; y: number };
    rightWrist: { x: number; y: number };
    leftHip: { x: number; y: number };
    rightHip: { x: number; y: number };
    leftKnee: { x: number; y: number };
    rightKnee: { x: number; y: number };
    leftAnkle: { x: number; y: number };
    rightAnkle: { x: number; y: number };
  };
};

export type FixedElement = {
  id: string;
  name: string;
  position: "left" | "right" | "front" | "back" | "center" | "left-front" | "right-front" | "left-back" | "right-back" | "custom";
  customPosition?: string;
  size: string; // e.g. "2m x 1.5m"
  description: string;
  fixed: boolean; // 不可变元素
};

export type LightSource = {
  position: string; // e.g. "ceiling center", "left wall"
  color: string; // e.g. "青白色", "暖黄"
  intensity: "dim" | "normal" | "bright" | "harsh";
  direction?: string; // e.g. "top-down", "side-left"
};

export type SceneBlock = {
  id: string;
  sceneAssetId?: string; // 关联场景资产
  backgroundAssetId?: string; // 空场景/全景图素材
  roomShape?: "rectangular" | "L-shaped" | "square" | "circular" | "irregular";
  dimensions?: { depth: number; width: number; height: number };
  fixedElements: FixedElement[];
  lightSource: LightSource;
  atmosphere?: string; // e.g. "压抑", "诡异", "温暖"
  // 3D 场景设置
  backgroundColor?: string;
  showGrid?: boolean;
  sceneScale?: number;
  sceneRotation?: { x: number; y: number; z: number };
  sceneTranslation?: { x: number; y: number; z: number };
};

export type Camera3DData = {
  id: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
  far: number;
  shotType?: string;
  cameraMove?: string;
};

export type DirectorBlock = {
  id: string;
  shotId: string; // 关联镜头
  sceneBlock: SceneBlock;
  characters: CharacterBlock[];
  cameraPosition?: { x: number; y: number; z?: number }; // 机位
  cameraTarget?: { x: number; y: number }; // 看向哪里
  cameras?: Camera3DData[]; // 3D 机位列表
  notes?: string; // 导演备注
};

export type SeedreamProject = {
  id: string;
  conversationId?: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  idea: string;
  flowStage?: StoryFlowStage;
  modelStrategy?: WorkflowModelStrategy;
  workflowModels?: Partial<WorkflowModelConfig>;
  originalIdea?: string;
  outlineSource?: string;
  ideaSourceReference?: string;
  ideaChatMessages?: ScriptChatMessage[];
  scriptSummary?: ScriptSummary;
  episodeOutlines?: EpisodeOutline[];
  episodeScripts?: EpisodeScript[];
  activeEpisode?: number;
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
  directorBlocks?: DirectorBlock[];
  generatorGroups?: GeneratorGroup[];
  canvasNodes?: import("./ManjuCanvas").CanvasNode[];
  canvasConnections?: import("./ManjuCanvas").CanvasConnection[];
};

export type GeneratorGroup = {
  id: string;
  title: string;
  mode: GeneratorGroupMode;
  shotIds: string[];
  modelLabel: string;
  aspectRatio: string;
  resolution?: string;
  duration?: number;
  promptPreview: string;
  createdAt: string;
};
