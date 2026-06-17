"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Download, ImageIcon, Loader2, MessageSquare, PanelLeftOpen, Paperclip, Play, Plus, RefreshCw, Send, Sparkles, Trash2, UploadCloud, Video, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useImage, type GeneratedImage } from "@/hooks/useImage";
import { useVideo, type VideoGeneration } from "@/hooks/useVideo";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { consumeChatStream } from "@/lib/chatStream";
import { getErrorMessage, readApiError } from "@/lib/errors";

import {
  ASSET_ROLE_OPTIONS,
  CAMERA_MOVES,
  IMAGE_ASPECTS,
  IMAGE_RESOLUTIONS,
  SEEDREAM_IMAGE_QUALITY,
  SEMANTIC_ASSET_KINDS,
  SETTING_BOARD_IMAGES,
  SHOT_PURPOSES,
  SHOT_TYPES,
  VIDEO_ASPECTS,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_REFERENCE_ROLES,
  VIDEO_RESOLUTIONS,
  WORKFLOW_DRAFT_MODEL,
  WORKFLOW_MODEL,
  WORKFLOW_POLISH_MODEL,
  WORKFLOW_STEPS,
} from "./constants";
import type {
  AssetAssistantMode,
  AssetKind,
  AssetKindFilter,
  AssetRole,
  BatchMode,
  CameraMove,
  GenerationJob,
  ScriptAssistantMode,
  ScriptChatMessage,
  SeedreamProject,
  SemanticAsset,
  SemanticAssetKind,
  ShotPurpose,
  ShotStatus,
  ShotType,
  DirectorBlock,
  StoredAsset,
  StoryboardShot,
  Tab,
  WorkflowMode,
  WorkflowView,
} from "./types";
import { FieldLabel, PillButton } from "./components";
import { useSeedreamProjects } from "./useSeedreamProjects";
import SeedreamWorkflowOverview from "./SeedreamWorkflowOverview";
import SeedreamVideoTab from "./SeedreamVideoTab";
import SeedreamImageTab from "./SeedreamImageTab";
import DirectorPanel from "./DirectorPanel";
import ShotPromptInspector from "./ShotPromptInspector";
import BatchPreflightPanel from "./BatchPreflightPanel";
import DirectorInheritanceControls from "./DirectorInheritanceControls";
import ShotOverviewTable from "./ShotOverviewTable";
import ManjuNodePanel from "./ManjuNodePanel";
import ManjuStudioLayout from "./ManjuStudioLayout";
import type { CanvasNode } from "./ManjuCanvas";
import { copyDirectorBlockToShots, createDefaultDirectorBlock, findDirectorBlockForShot, getSceneAssetForShot, injectDirectorBlockToPrompt } from "./directorBlock";

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function getAuthOnlyHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function extractTextFromChatResponse(data: any): string {
  const choice = data?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || data?.message?.content || data?.content || "";
}

function stripWorkflowText(text: string) {
  return text
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/<\/?(?:TITLE|CONTENT|SCRIPT|ASSETS|STORYBOARD|PROMPTS|REPLY)>/g, "")
    .trim();
}


function getAssetKind(mimeType?: string, filename?: string): AssetKind {
  const lowerName = (filename || "").toLowerCase();
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return "image";
  if (mimeType?.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(lowerName)) return "video";
  return "file";
}

function assetViewUrl(publicIdOrUrl: string) {
  if (!publicIdOrUrl) return "";
  if (/^https?:\/\//i.test(publicIdOrUrl) || publicIdOrUrl.startsWith("/")) return publicIdOrUrl;
  if (publicIdOrUrl.startsWith("file_")) return `/api/files/${publicIdOrUrl}/view`;
  return publicIdOrUrl;
}

function formatAssetSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}


function getAssetRoleLabel(role?: AssetRole) {
  return ASSET_ROLE_OPTIONS.find((item) => item.value === role)?.label || "参考";
}

function getSemanticAssetKindLabel(kind: SemanticAssetKind) {
  return SEMANTIC_ASSET_KINDS.find((item) => item.value === kind)?.label || "资产";
}

function isStoryboardSketchAsset(asset: StoredAsset) {
  return asset.source === "storyboard_sketch" || asset.name.includes("故事版草稿");
}

function getShotStatusLabel(status: ShotStatus) {
  const labels: Record<ShotStatus, string> = {
    draft: "草稿",
    image_generating: "生图中",
    image_ready: "图已出",
    video_generating: "视频中",
    video_ready: "视频已出",
    failed: "失败",
  };
  return labels[status] || status;
}


function buildSemanticLockPrompt(items: SemanticAsset[]) {
  if (!items.length) return "";
  return items.map((item) => {
    const lines = [`【${getSemanticAssetKindLabel(item.kind)}：${item.name}】`];
    if (item.summary) lines.push(item.summary);
    if (item.lockPrompt) lines.push(`锁定词：${item.lockPrompt}`);
    if (item.negativePrompt) lines.push(`禁用：${item.negativePrompt}`);
    return lines.join("\n");
  }).join("\n\n");
}

function isShotType(value: string): value is ShotType {
  return SHOT_TYPES.includes(value as ShotType);
}

function isCameraMove(value: string): value is CameraMove {
  return CAMERA_MOVES.includes(value as CameraMove);
}

function isShotPurpose(value: string): value is ShotPurpose {
  return SHOT_PURPOSES.includes(value as ShotPurpose);
}

function isSeedanceReferenceTag(value: string) {
  return /^(?:视频|圖片|图片|图|image|img|video|ref|素材)\s*[#\d一二三四五六七八九十_-]*$/i.test(value.trim());
}

function extractSeedanceMarkedText(text: string) {
  const dialogue = Array.from(text.matchAll(/\{([^{}\n]{1,160})\}/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join("\n");
  const soundEffects = Array.from(text.matchAll(/<([^<>\n]{1,120})>/g))
    .map((match) => match[1].trim())
    .filter((value) => value && !isSeedanceReferenceTag(value))
    .join("\n");
  return { dialogue, narration: "", soundEffects };
}

function cleanLegacyDialogueNarration(value?: string) {
  return (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "放下手机" && line !== "物体遮挡镜头" && !isSeedanceReferenceTag(line))
    .join("\n");
}

function normalizeLoadedShot(shot: StoryboardShot): StoryboardShot {
  return {
    ...shot,
    dialogue: cleanLegacyDialogueNarration(shot.dialogue),
    narration: cleanLegacyDialogueNarration(shot.narration),
  };
}

function getShotAssets(shot: StoryboardShot | undefined, allAssets: StoredAsset[]) {
  if (!shot) return [];
  const ids = new Set([
    ...shot.referenceAssetIds,
    ...shot.imageAssetIds,
    ...shot.videoAssetIds,
    shot.firstFrameAssetId,
    shot.lastFrameAssetId,
    shot.referenceVideoAssetId,
  ].filter(Boolean) as string[]);
  return allAssets.filter((asset) => ids.has(asset.id));
}

function createShot(index: number, patch: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: patch.id || `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    index,
    title: patch.title || `镜头 ${index}`,
    scene: patch.scene || "",
    characters: patch.characters || [],
    dialogue: patch.dialogue || "",
    narration: patch.narration || "",
    imagePrompt: patch.imagePrompt || "",
    videoPrompt: patch.videoPrompt || "",
    shotType: patch.shotType || "中景",
    cameraMove: patch.cameraMove || "固定",
    purpose: patch.purpose || "信息揭示",
    duration: patch.duration || 5,
    aspectRatio: patch.aspectRatio || "9:16",
    status: patch.status || "draft",
    referenceAssetIds: patch.referenceAssetIds || [],
    imageAssetIds: patch.imageAssetIds || [],
    videoAssetIds: patch.videoAssetIds || [],
    firstFrameAssetId: patch.firstFrameAssetId,
    lastFrameAssetId: patch.lastFrameAssetId,
    referenceVideoAssetId: patch.referenceVideoAssetId,
    semanticAssetIds: patch.semanticAssetIds || [],
  };
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function parseStoryboardShots(text: string): StoryboardShot[] {
  const cleaned = stripJsonFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : parsed?.shots;
    if (Array.isArray(list)) {
      return list.map((item: any, idx: number) => createShot(Number(item.index || idx + 1), {
        id: item.id,
        title: item.title || item.name || `镜头 ${idx + 1}`,
        scene: item.scene || item.location || "",
        characters: Array.isArray(item.characters) ? item.characters : String(item.characters || "").split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
        dialogue: item.dialogue || "",
        narration: item.narration || item.voiceover || "",
        imagePrompt: item.imagePrompt || item.image_prompt || item.seedream_prompt || "",
        videoPrompt: item.videoPrompt || item.video_prompt || item.seedance_prompt || "",
        shotType: isShotType(String(item.shotType || item.shot_type || item.shot_size || "")) ? String(item.shotType || item.shot_type || item.shot_size) as ShotType : "中景",
        cameraMove: isCameraMove(String(item.cameraMove || item.camera_move || item.camera || "")) ? String(item.cameraMove || item.camera_move || item.camera) as CameraMove : "固定",
        purpose: isShotPurpose(String(item.purpose || item.shot_purpose || "")) ? String(item.purpose || item.shot_purpose) as ShotPurpose : "信息揭示",
        duration: Number(item.duration || item.duration_seconds || 5),
        aspectRatio: item.aspectRatio || item.aspect_ratio || "9:16",
      }));
    }
  } catch {
    // fallback below
  }
  const shotHeadingPattern = /^\s*(?:#{2,4}\s*)?(?:段\s*[0-9一二三四五六七八九十]+(?:[｜|、.\s]|$)|(?:镜头|分镜|Shot)\s*\d+)/i;
  const chunks = cleaned
    .split(/\n(?=\s*(?:(?:#{2,4}\s*)?段\s*[0-9一二三四五六七八九十]+[｜|、.\s]|(?:#{2,4}\s*)?(?:镜头|分镜|Shot)\s*\d+))/i)
    .map((x) => x.trim())
    .filter((chunk) => chunk && shotHeadingPattern.test(chunk));
  if (!chunks.length) return [];
  return chunks.map((chunk, idx) => {
    const firstLine = chunk.split("\n").find((line) => line.trim())?.replace(/^#{1,6}\s*/, "").trim() || `镜头 ${idx + 1}`;
    const seedancePrompt = chunk.match(/(?:\*\*Seedance提示词：\*\*|Seedance提示词[:：]|直接投喂提示词[:：]|视频提示词[:：]|video_prompt[:：])\s*([\s\S]*?)(?=\n\s*(?:\*\*[^*]+：\*\*|#{2,4}\s*段|#{2,4}\s*(?:镜头|分镜)|---|$))/i)?.[1]?.trim();
    const imagePrompt = chunk.match(/(?:image_prompt|图片提示词|分镜图提示词|Seedream提示词)[:：]\s*([\s\S]*?)(?=\n\s*(?:video_prompt|视频提示词|Seedance提示词|直接投喂提示词|#{2,4}\s*段|#{2,4}\s*(?:镜头|分镜)|---|$))/i)?.[1]?.trim() || "";
    const scene = chunk.match(/(?:场景|地点|素材绑定)[:：]\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:\*\*空间锚点：\*\*)\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:空间锚点)[:：]\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:\*\*视角：\*\*)\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:视角)[:：]\s*(.+)/)?.[1]?.trim()
      || "";
    const durationMatch = chunk.match(/[（(]?(\d+)\s*秒[）)]?/) || chunk.match(/(?:时长|duration)[:：]\s*(\d+)/i);
    const seedanceMarked = extractSeedanceMarkedText(chunk);
    return createShot(idx + 1, {
      title: firstLine.slice(0, 60),
      scene,
      dialogue: seedanceMarked.dialogue,
      narration: seedanceMarked.narration,
      imagePrompt,
      videoPrompt: seedancePrompt || chunk.match(/(?:video_prompt|视频提示词)[:：]\s*([\s\S]*?)$/i)?.[1]?.trim() || chunk,
      shotType: isShotType(chunk.match(/(?:景别|镜头类型)[:：]\s*(.+)/)?.[1]?.trim() || "") ? chunk.match(/(?:景别|镜头类型)[:：]\s*(.+)/)![1].trim() as ShotType : "中景",
      cameraMove: isCameraMove(chunk.match(/(?:运镜|镜头运动|视角)[:：]\s*(.+)/)?.[1]?.trim() || "") ? chunk.match(/(?:运镜|镜头运动|视角)[:：]\s*(.+)/)![1].trim() as CameraMove : "固定",
      purpose: (chunk.match(/(?:功能|镜头目的|目的)[:：]\s*(.+)/)?.[1]?.trim().slice(0, 20) as ShotPurpose) || "信息揭示",
      duration: durationMatch ? Number(durationMatch[1]) : 5,
    });
  });
}

function parseSemanticAssets(text: string): SemanticAsset[] {
  const cleaned = stripJsonFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : parsed?.assets || parsed?.semanticAssets;
    if (Array.isArray(list)) {
      return list.map((item: any) => ({
        id: item.id || `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: (item.kind || item.type || "character") as SemanticAssetKind,
        name: item.name || item.title || "未命名资产",
        summary: item.summary || item.description || "",
        lockPrompt: item.lockPrompt || item.lock_prompt || item.image_prompt || item.prompt || "",
        negativePrompt: item.negativePrompt || item.negative_prompt || "",
        linkedAssetIds: Array.isArray(item.linkedAssetIds) ? item.linkedAssetIds : [],
        createdAt: item.createdAt || new Date().toISOString(),
      })).filter((item: SemanticAsset) => ["character", "scene", "prop", "style"].includes(item.kind));
    }
  } catch {
    // fallback below
  }
  const blocks = cleaned.split(/\n(?=\s*(?:角色|场景|道具|风格|资产)[一二三四五六七八九十\d：:])/).map((x) => x.trim()).filter(Boolean);
  return blocks.map((block) => {
    const first = block.split("\n")[0] || "未命名资产";
    const kind: SemanticAssetKind = first.includes("场景") ? "scene" : first.includes("道具") ? "prop" : first.includes("风格") ? "style" : "character";
    const name = first.replace(/^(?:角色|场景|道具|风格|资产)[一二三四五六七八九十\d]*[：:]?/, "").trim() || first.slice(0, 20);
    return {
      id: `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name,
      summary: block,
      lockPrompt: block.match(/(?:image_prompt|图片提示词|锁定词|prompt)[:：]\s*([\s\S]*?)$/i)?.[1]?.trim() || block,
      negativePrompt: "",
      linkedAssetIds: [],
      createdAt: new Date().toISOString(),
    };
  });
}

function workflowSystemPrompt(mode: WorkflowMode) {
  const common = "你是 AI Space 的影视/小说创作前期助手。不要联网搜索。输出要直接可编辑、可复制，不要解释思考过程，不要使用 Markdown 代码块。";
  if (mode === "novel") return `${common}\n任务：根据用户创意写完整小说，有明确开端、发展、高潮和结尾；人物动机清楚；画面感强。输出格式：<TITLE>标题</TITLE><CONTENT>完整小说正文</CONTENT>`;
  if (mode === "script") return `${common}\n任务：把用户输入的【本集大概内容】改写成影视剧本。不要要求或依赖整本小说/附件素材；只基于用户提供的本集梗概、关键情节、人物关系和明确改编要求生成。缺失细节可以合理补足，但不要声称读取了原小说。按幕/场组织，每场包含地点、时间、人物、动作、对白/旁白；优先服务本集强钩子和可拍摄性。输出格式：<TITLE>剧本标题</TITLE><SCRIPT>完整剧本</SCRIPT>`;
  if (mode === "assets") return `${common}\n任务：根据剧本提取前期制作资产。必须覆盖角色、场景、关键道具、整体风格。每个资产都要包含可用于 Seedream 生图的 lock_prompt 和 negative_prompt。优先输出 JSON：{ "assets": [{ "kind": "character", "name": "", "summary": "", "lock_prompt": "", "negative_prompt": "" }] }，kind 只能是 character/scene/prop/style。不要输出代码块。`;
  if (mode === "storyboardVideo") return `${common}\n任务：根据剧本和资产设定生成视频分镜脚本提示词。每个镜头必须包含：镜头编号、场景、画面、镜头运动、角色动作、台词/旁白、建议时长、可直接用于 Seedance 视频生成的 video_prompt。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "video_prompt": "" }] }。不要输出代码块。`;
  return `${common}\n任务：根据剧本、资产和视频分镜，生成 Seedream 分镜图提示词。每个镜头一条 image_prompt，强调静态构图、主体、景别、光线、角色/服装/场景一致性。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "image_prompt": "", "video_prompt": "" }] }。不要输出代码块。`;
}


const TAB_VALUES: Tab[] = ["workflow", "image", "video"];
const WORKFLOW_MODE_VALUES: WorkflowMode[] = ["script", "assets", "storyboardVideo", "storyboardImage"];

export default function SeedreamBetaPage() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { images, generateImage, isGenerating, fetchImages } = useImage("seedream");
  const { videos, generateVideo, generating: videoGenerating } = useVideo();

  const { setProjects, activeProject } = useSeedreamProjects(t("seedreamBeta.projects.newProject"));
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("workflow");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("2K");
  const [lastImageId, setLastImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [previewAsset, setPreviewAsset] = useState<StoredAsset | null>(null);

  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0]);
  const [videoAspect, setVideoAspect] = useState("adaptive");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(false);
  const [lastVideoId, setLastVideoId] = useState<number | null>(null);

  const [workflowView, setWorkflowView] = useState<WorkflowView>("overview");
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("script");

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const modeParam = searchParams.get("mode");
    if (tabParam && TAB_VALUES.includes(tabParam as Tab)) {
      setTab(tabParam as Tab);
    }
    if (modeParam && WORKFLOW_MODE_VALUES.includes(modeParam as WorkflowMode)) {
      setTab("workflow");
      setWorkflowMode(modeParam as WorkflowMode);
      setWorkflowView("step");
    } else if (tabParam === "workflow" && !modeParam) {
      setWorkflowView("overview");
    }
  }, [searchParams]);

  const [workflowIdea, setWorkflowIdea] = useState("");
  const [workflowNovel, setWorkflowNovel] = useState("");
  const [scriptSourceExcerpt, setScriptSourceExcerpt] = useState("");
  const [scriptAdaptationInstruction, setScriptAdaptationInstruction] = useState("");
  const [workflowScript, setWorkflowScript] = useState("");
  const [workflowAssets, setWorkflowAssets] = useState("");
  const [workflowStoryboardVideo, setWorkflowStoryboardVideo] = useState("");
  const [workflowStoryboardImage, setWorkflowStoryboardImage] = useState("");
  const [workflowGenerating, setWorkflowGenerating] = useState<WorkflowMode | null>(null);
  const [scriptRevisionInstruction, setScriptRevisionInstruction] = useState("");
  const [scriptAssistantMode, setScriptAssistantMode] = useState<ScriptAssistantMode>("chat");
  const [scriptChatInput, setScriptChatInput] = useState("");
  const [scriptChatMessages, setScriptChatMessages] = useState<ScriptChatMessage[]>([]);
  const [scriptChatting, setScriptChatting] = useState(false);
  const [scriptRevising, setScriptRevising] = useState(false);
  const [assetRegenerateInstruction, setAssetRegenerateInstruction] = useState("");
  const [assetRegeneratingId, setAssetRegeneratingId] = useState<string | null>(null);
  const [assetAssistantMode, setAssetAssistantMode] = useState<AssetAssistantMode>("chat");
  const [assetChatInput, setAssetChatInput] = useState("");
  const [assetChatMessages, setAssetChatMessages] = useState<ScriptChatMessage[]>([]);
  const [assetChatting, setAssetChatting] = useState(false);
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [storyboardShots, setStoryboardShots] = useState<StoryboardShot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | undefined>();
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [semanticAssets, setSemanticAssets] = useState<SemanticAsset[]>([]);
  const [directorBlocks, setDirectorBlocks] = useState<DirectorBlock[]>([]);
  const [selectedOverviewShotIds, setSelectedOverviewShotIds] = useState<string[]>([]);
  const [activeSemanticAssetId, setActiveSemanticAssetId] = useState<string | undefined>();
  const [assetImageGeneratingId, setAssetImageGeneratingId] = useState<string | null>(null);
  const [showAssetLibraryPicker, setShowAssetLibraryPicker] = useState(false);
  const [assetKindFilter, setAssetKindFilter] = useState<AssetKindFilter>("all");
  const [batchGenerating, setBatchGenerating] = useState<"sketches" | "images" | "videos" | null>(null);
  const [batchMode, setBatchMode] = useState<BatchMode>("missing");
  const [batchLimit, setBatchLimit] = useState(6);
  const [showDirectorPanel, setShowDirectorPanel] = useState(false);
  const [scriptImportText, setScriptImportText] = useState("");
  const [storyboardImportText, setStoryboardImportText] = useState("");
  const [seedanceImportText, setSeedanceImportText] = useState("");
  const batchCancelRef = useRef(false);

  const lastImage: GeneratedImage | undefined = useMemo(() => {
    if (!lastImageId) return images[0];
    return images.find((item) => item.id === lastImageId) || images[0];
  }, [images, lastImageId]);

  const lastVideo: VideoGeneration | undefined = useMemo(() => {
    if (!lastVideoId) return videos[0];
    return videos.find((item) => item.id === lastVideoId) || videos[0];
  }, [videos, lastVideoId]);

  const workflowStep = WORKFLOW_STEPS.find((item) => item.id === workflowMode) || WORKFLOW_STEPS[0];
  const isProductionBenchMode = workflowMode === "storyboardVideo" || workflowMode === "storyboardImage";

  const workflowStepCards = useMemo(() => {
    const getContent = (id: WorkflowMode) => {
      if (id === "novel") return workflowNovel || workflowIdea;
      if (id === "script") return workflowScript;
      if (id === "assets") return workflowAssets || semanticAssets.map((item) => item.name).join(" ");
      if (id === "storyboardVideo") return workflowStoryboardVideo || storyboardShots.map((item) => item.videoPrompt).join(" ");
      return workflowStoryboardImage || storyboardShots.map((item) => item.imagePrompt).join(" ");
    };
    const getCount = (id: WorkflowMode) => {
      if (id === "novel") return workflowNovel.trim() ? `${Math.round(workflowNovel.length / 100) / 10}k 字` : workflowIdea.trim() ? "已有创意" : "待输入";
      if (id === "script") return workflowScript.trim() ? `${Math.round(workflowScript.length / 100) / 10}k 字` : "待生成";
      if (id === "assets") return semanticAssets.length ? `${semanticAssets.length} 个资产` : workflowAssets.trim() ? "待解析" : "待生成";
      if (id === "storyboardVideo") return storyboardShots.length ? `${storyboardShots.length} 镜头` : workflowStoryboardVideo.trim() ? "待解析" : "待生成";
      return storyboardShots.length ? `${storyboardShots.length} 镜头` : workflowStoryboardImage.trim() ? "待解析" : "待生成";
    };
    return WORKFLOW_STEPS.map((step, index) => {
      const content = getContent(step.id).trim();
      return {
        ...step,
        index,
        done: Boolean(content),
        count: getCount(step.id),
        preview: content.slice(0, 90),
      };
    });
  }, [workflowIdea, workflowNovel, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, semanticAssets, storyboardShots]);

  const projectStats = useMemo(() => {
    const formalImageReadyCount = storyboardShots.filter((shot) => assets.some((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image" && !isStoryboardSketchAsset(asset)) || shot.status === "image_ready" || shot.status === "video_generating" || shot.status === "video_ready").length;
    const videoReadyCount = storyboardShots.filter((shot) => (shot.videoAssetIds || []).length > 0 || shot.status === "video_ready").length;
    return [
      { label: "本集剧情", value: scriptSourceExcerpt.trim() ? "已输入" : workflowIdea.trim() ? "有梗概" : "待输入", done: Boolean(scriptSourceExcerpt.trim() || workflowIdea.trim()) },
      { label: "剧本", value: workflowScript.trim() ? "已完成" : "待生成", done: Boolean(workflowScript.trim()) },
      { label: "资产", value: semanticAssets.length ? `${semanticAssets.length} 个` : "待生成", done: semanticAssets.length > 0 },
      { label: "镜头", value: storyboardShots.length ? `${storyboardShots.length} 个` : "待生成", done: storyboardShots.length > 0 },
      { label: "正式图", value: storyboardShots.length ? `${formalImageReadyCount}/${storyboardShots.length}` : "待生成", done: storyboardShots.length > 0 && formalImageReadyCount >= storyboardShots.length },
      { label: "视频", value: storyboardShots.length ? `${videoReadyCount}/${storyboardShots.length}` : "待生成", done: storyboardShots.length > 0 && videoReadyCount >= storyboardShots.length },
    ];
  }, [workflowIdea, scriptSourceExcerpt, workflowScript, semanticAssets, storyboardShots, assets]);

  const importChecks = useMemo(() => {
    const totalShots = storyboardShots.length;
    const videoPromptCount = storyboardShots.filter((shot) => shot.videoPrompt.trim()).length;
    const imagePromptCount = storyboardShots.filter((shot) => shot.imagePrompt.trim()).length;
    const semanticBoundCount = storyboardShots.filter((shot) => shot.semanticAssetIds.length > 0).length;
    const materialBoundCount = storyboardShots.filter((shot) => shot.referenceAssetIds.length > 0).length;
    const sketchCount = storyboardShots.filter((shot) => assets.some((asset) => shot.imageAssetIds.includes(asset.id) && isStoryboardSketchAsset(asset))).length;
    const formalImageCount = storyboardShots.filter((shot) => assets.some((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image" && !isStoryboardSketchAsset(asset))).length;
    const bareAssetCodeCount = storyboardShots.reduce((count, shot) => count + (shot.videoPrompt.match(/\b[PSV]\d{2}[A-Z]?\b/g) || []).length + (shot.imagePrompt.match(/\b[PSV]\d{2}[A-Z]?\b/g) || []).length, 0);
    const mappedReferenceCount = storyboardShots.reduce((count, shot) => count + shot.referenceAssetIds.length, 0);
    return [
      { label: "纯剧本", value: workflowScript.trim() ? `${workflowScript.trim().length} 字` : "未导入", ok: workflowScript.trim().length > 100, hint: "应只有场景、动作、对白、旁白，不混入 Seedance 指令。" },
      { label: "语义资产", value: semanticAssets.length ? `${semanticAssets.length} 个` : "未导入/未生成", ok: semanticAssets.length > 0, hint: "角色、场景、道具、风格应在这里，不只是素材库图片。" },
      { label: "素材库", value: assets.length ? `${assets.length} 个素材` : "暂无素材", ok: assets.length > 0, hint: "已有角色图/场景图应上传到素材库并关联资产或镜头。" },
      { label: "镜头卡", value: totalShots ? `${totalShots} 镜头` : "未解析", ok: totalShots > 0, hint: "故事板版应解析成镜头卡，而不是只留在原始文本里。" },
      { label: "视频提示词", value: totalShots ? `${videoPromptCount}/${totalShots}` : "0/0", ok: totalShots > 0 && videoPromptCount === totalShots, hint: "Seedance直接投喂版应覆盖每个镜头的视频提示词。" },
      { label: "分镜图提示词", value: totalShots ? `${imagePromptCount}/${totalShots}` : "0/0", ok: totalShots > 0 && imagePromptCount > 0, hint: "可为空一部分，但生成正式图前需要补齐关键镜头。" },
      { label: "镜头资产绑定", value: totalShots ? `${Math.max(semanticBoundCount, materialBoundCount)}/${totalShots}` : "0/0", ok: totalShots > 0 && (semanticBoundCount > 0 || materialBoundCount > 0), hint: "导入后还需要给镜头绑定角色/场景/参考素材。" },
      { label: "素材编号映射", value: bareAssetCodeCount ? `${bareAssetCodeCount} 个编号 · 已绑 ${mappedReferenceCount}` : "无裸编号", ok: bareAssetCodeCount === 0 || mappedReferenceCount > 0, hint: "S01/P01/V04 这类编号只是制作代号，生成前要绑定为真实素材引用。" },
      { label: "图像产物", value: totalShots ? `草稿 ${sketchCount}/${totalShots} · 正式 ${formalImageCount}/${totalShots}` : "暂无", ok: true, hint: "草稿图只验构图，正式图才做视频首帧。" },
    ];
  }, [workflowScript, semanticAssets, assets, storyboardShots]);

  useEffect(() => {
    setShowAssetLibraryPicker(false);
  }, [activeSemanticAssetId]);

  const openWorkflowOverview = () => {
    setTab("workflow");
    setWorkflowView("overview");
    router.replace("/seedream-beta?tab=workflow", { scroll: false });
  };

  const openWorkflowStep = (mode: WorkflowMode) => {
    setTab("workflow");
    setWorkflowMode(mode);
    setWorkflowView("step");
    router.replace(`/seedream-beta?tab=workflow&mode=${mode}`, { scroll: false });
  };

  const mergeStoryboardShots = (nextText: string, mode: "storyboard" | "seedance") => {
    const parsedShots = parseStoryboardShots(nextText);
    if (!parsedShots.length) {
      toast.error("没有解析到镜头/段落，请检查格式是否包含“段01”或“镜头1”。");
      return;
    }
    setStoryboardShots((prev) => {
      const merged = parsedShots.map((shot, index) => {
        const existing = prev[index];
        if (!existing) return shot;
        if (mode === "seedance") {
          return {
            ...existing,
            videoPrompt: shot.videoPrompt || existing.videoPrompt,
            dialogue: shot.dialogue || cleanLegacyDialogueNarration(existing.dialogue),
            narration: shot.narration || cleanLegacyDialogueNarration(existing.narration),
            duration: shot.duration || existing.duration,
            aspectRatio: shot.aspectRatio || existing.aspectRatio,
          };
        }
        return {
          ...existing,
          index: shot.index || index + 1,
          title: shot.title || existing.title,
          scene: shot.scene || existing.scene,
          characters: shot.characters.length ? shot.characters : existing.characters,
          dialogue: shot.dialogue,
          narration: shot.narration,
          imagePrompt: shot.imagePrompt || existing.imagePrompt,
          videoPrompt: shot.videoPrompt || existing.videoPrompt,
          shotType: shot.shotType || existing.shotType,
          cameraMove: shot.cameraMove || existing.cameraMove,
          purpose: shot.purpose || existing.purpose,
          duration: shot.duration || existing.duration,
          aspectRatio: shot.aspectRatio || existing.aspectRatio,
        };
      });
      setActiveShotId(merged[0]?.id);
      return merged;
    });
    if (mode === "storyboard") setWorkflowStoryboardVideo(nextText);
    else setWorkflowStoryboardVideo((prev) => prev || nextText);
    openWorkflowStep("storyboardVideo");
    toast.success(`${mode === "storyboard" ? "故事板" : "Seedance投喂版"}已导入，并进入故事板生产台（${parsedShots.length} 张镜头卡）`);
  };

  const importLayerText = (layer: "script" | "storyboard" | "seedance", text: string) => {
    const clean = stripWorkflowText(text);
    if (!clean) {
      toast.error("导入内容为空");
      return;
    }
    if (layer === "script") {
      setWorkflowScript(clean);
      setScriptSourceExcerpt((prev) => prev || clean.slice(0, 2000));
      openWorkflowStep("script");
      toast.success(`纯剧本已导入，约 ${clean.length} 字`);
      return;
    }
    mergeStoryboardShots(clean, layer);
  };

  const handleImportFile = (layer: "script" | "storyboard" | "seedance", event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importLayerText(layer, String(reader.result || ""));
    reader.onerror = () => toast.error("读取文件失败");
    reader.readAsText(file);
  };

  const focusAssetKind = (kind: AssetKindFilter) => {
    setAssetKindFilter(kind);
    if (kind === "all") {
      setActiveSemanticAssetId((prev) => prev || semanticAssets[0]?.id);
      return;
    }
    const first = semanticAssets.find((asset) => asset.kind === kind);
    if (first) setActiveSemanticAssetId(first.id);
    else addSemanticAsset(kind);
  };

  const workspaceProjectName = activeProject?.title || t("seedreamBeta.navLabel");

  const ensureWorkflowConversationId = async () => {
    if (activeProject?.conversationId) return activeProject.conversationId;
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title: workspaceProjectName || "漫剧项目",
        model: WORKFLOW_MODEL,
        skill_key: "seedream-beta",
      }),
    });
    if (!response.ok) throw await readApiError(response);
    const conversation = await response.json();
    const conversationId = Number(conversation?.id);
    if (!Number.isFinite(conversationId)) throw new Error("创建漫剧消息组失败");
    if (activeProject?.id) {
      setProjects((prev) => prev.map((project) => project.id === activeProject.id ? { ...project, conversationId, updatedAt: new Date().toISOString() } : project));
    }
    return conversationId;
  };

  useEffect(() => {
    if (!activeProject) return;
    setWorkflowIdea(activeProject.idea || "");
    setWorkflowNovel(activeProject.novel || "");
    setScriptSourceExcerpt(activeProject.scriptSourceExcerpt || "");
    setScriptAdaptationInstruction(activeProject.scriptAdaptationInstruction || "");
    setWorkflowScript(activeProject.script || "");
    setWorkflowAssets(activeProject.assetsText || "");
    setWorkflowStoryboardVideo(activeProject.storyboardVideo || "");
    setWorkflowStoryboardImage(activeProject.storyboardImage || "");
    setAssets(activeProject.assets || []);
    setSelectedAssetIds(activeProject.selectedAssetIds || []);
    setImagePrompt(activeProject.imagePrompt || "");
    setVideoPrompt(activeProject.videoPrompt || "");
    const loadedShots = (activeProject.storyboardShots || []).map(normalizeLoadedShot);
    setStoryboardShots(loadedShots);
    setActiveShotId(activeProject.activeShotId || loadedShots[0]?.id);
    setGenerationJobs(activeProject.generationJobs || []);
    setSemanticAssets(activeProject.semanticAssets || []);
    setDirectorBlocks(activeProject.directorBlocks || []);
    setActiveSemanticAssetId(activeProject.semanticAssets?.[0]?.id);
    setLoadedProjectId(activeProject.id);
  }, [activeProject?.id]);


  useEffect(() => {
    if (!activeProject || loadedProjectId !== activeProject.id) return;
    setProjects((prev) => prev.map((project) => project.id === activeProject.id ? {
      ...project,
      title: activeProject.title,
      idea: workflowIdea,
      novel: workflowNovel,
      scriptSourceExcerpt,
      scriptAdaptationInstruction,
      script: workflowScript,
      assetsText: workflowAssets,
      storyboardVideo: workflowStoryboardVideo,
      storyboardImage: workflowStoryboardImage,
      assets,
      selectedAssetIds,
      imagePrompt,
      videoPrompt,
      storyboardShots,
      activeShotId,
      generationJobs,
      semanticAssets,
      directorBlocks,
      updatedAt: new Date().toISOString(),
    } : project));
  }, [activeProject?.id, loadedProjectId, workflowIdea, workflowNovel, scriptSourceExcerpt, scriptAdaptationInstruction, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, assets, selectedAssetIds, imagePrompt, videoPrompt, storyboardShots, activeShotId, generationJobs, semanticAssets, directorBlocks]);



  useEffect(() => {
    const succeededImages = images.filter((image) => image.image_url && (image.status === "succeeded" || image.status === "completed"));
    const failedImages = images.filter((image) => image.status === "failed");
    if (!succeededImages.length && !failedImages.length) return;
    setGenerationJobs((prev) => prev.map((job) => {
      if (job.type !== "image" || job.status !== "pending") return job;
      const failedImage = failedImages.find((item) => item.id === job.mediaId);
      if (failedImage) return { ...job, status: "failed", updatedAt: new Date().toISOString() };
      const image = succeededImages.find((item) => item.id === job.mediaId);
      if (!image) return job;
      const shot = storyboardShots.find((item) => item.id === job.shotId);
      const semanticAsset = semanticAssets.find((item) => item.id === job.semanticAssetId);
      const asset = createAssetFromImage(image, shot, semanticAsset, job.intent || (semanticAsset ? "asset_image" : "shot_image"));
      if (asset) {
        const existingAsset = assets.find((item) => item.publicId === asset.publicId && item.shotId === shot?.id);
        const assetIdToLink = existingAsset?.id || asset.id;
        const isSketch = job.intent === "storyboard_sketch";
        if (!existingAsset) setAssets((current) => [asset, ...current]);
        if (shot) updateShot(shot.id, isSketch
          ? { imageAssetIds: Array.from(new Set([...(shot.imageAssetIds || []), assetIdToLink])) }
          : { status: "image_ready", imageAssetIds: Array.from(new Set([...(shot.imageAssetIds || []), assetIdToLink])), referenceAssetIds: Array.from(new Set([...(shot.referenceAssetIds || []), assetIdToLink])), firstFrameAssetId: shot.firstFrameAssetId || assetIdToLink });
        if (semanticAsset) {
          setSemanticAssets((current) => current.map((item) => item.id === semanticAsset.id
            ? { ...item, linkedAssetIds: Array.from(new Set([...(item.linkedAssetIds || []), assetIdToLink])) }
            : item));
        }
      }
      return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    }));
  }, [images, storyboardShots, semanticAssets, assets]);

  useEffect(() => {
    const succeededVideos = videos.filter((video) => video.video_url && video.status === "succeeded");
    if (!succeededVideos.length) return;
    setGenerationJobs((prev) => prev.map((job) => {
      if (job.type !== "video" || job.status !== "pending") return job;
      const video = succeededVideos.find((item) => item.id === job.mediaId);
      if (!video) return job;
      const shot = storyboardShots.find((item) => item.id === job.shotId);
      const asset = createAssetFromVideo(video, shot);
      if (asset && !assets.some((item) => item.publicId === asset.publicId && item.shotId === shot?.id)) {
        setAssets((current) => [asset, ...current]);
        if (shot) updateShot(shot.id, { status: "video_ready", videoAssetIds: Array.from(new Set([...(shot.videoAssetIds || []), asset.id])), referenceVideoAssetId: shot.referenceVideoAssetId || asset.id });
      }
      return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    }));
  }, [videos, storyboardShots, assets]);

  const selectedAssets = useMemo(() => assets.filter((item) => selectedAssetIds.includes(item.id)), [assets, selectedAssetIds]);
  const activeShot = useMemo(() => storyboardShots.find((item) => item.id === activeShotId) || storyboardShots[0], [storyboardShots, activeShotId]);
  const activeDirectorBlock = useMemo(() => activeShot ? findDirectorBlockForShot(directorBlocks, activeShot.id) : undefined, [directorBlocks, activeShot]);
  const activeSemanticAsset = useMemo(() => semanticAssets.find((item) => item.id === activeSemanticAssetId) || semanticAssets[0], [semanticAssets, activeSemanticAssetId]);
  const activeSemanticAssetImageJobs = useMemo(() => activeSemanticAsset
    ? generationJobs.filter((job) => job.type === "image" && job.semanticAssetId === activeSemanticAsset.id).slice(0, 3)
    : [], [generationJobs, activeSemanticAsset]);
  const activeSemanticAssetImagePending = activeSemanticAssetImageJobs.some((job) => job.status === "pending");
  const filteredSemanticAssets = useMemo(() => assetKindFilter === "all" ? semanticAssets : semanticAssets.filter((item) => item.kind === assetKindFilter), [semanticAssets, assetKindFilter]);
  const activeShotSemanticAssets = useMemo(() => activeShot ? semanticAssets.filter((item) => activeShot.semanticAssetIds.includes(item.id)) : [], [semanticAssets, activeShot]);
  const selectedImageRefs = useMemo(() => selectedAssets.filter((item) => item.type === "image").map((item) => item.publicId || item.url), [selectedAssets]);
  const selectedVideoRefs = useMemo(() => selectedAssets.filter((item) => item.type === "video").map((item) => item.publicId || item.url), [selectedAssets]);
  const shotReferenceAssets = useMemo(() => getShotAssets(activeShot, assets), [assets, activeShot]);
  const activeShotImageAssets = useMemo(() => activeShot ? assets.filter((item) => activeShot.imageAssetIds.includes(item.id) && item.type === "image") : [], [assets, activeShot]);
  const activeShotSketchAssets = useMemo(() => activeShotImageAssets.filter(isStoryboardSketchAsset), [activeShotImageAssets]);
  const activeShotFormalImageAssets = useMemo(() => activeShotImageAssets.filter((asset) => !isStoryboardSketchAsset(asset)), [activeShotImageAssets]);
  const activeShotVideoAssets = useMemo(() => activeShot ? assets.filter((item) => activeShot.videoAssetIds.includes(item.id) && item.type === "video") : [], [assets, activeShot]);
  const activeShotFirstFrameAsset = useMemo(() => activeShot?.firstFrameAssetId ? assets.find((item) => item.id === activeShot.firstFrameAssetId) : undefined, [assets, activeShot]);
  const activeShotLastFrameAsset = useMemo(() => activeShot?.lastFrameAssetId ? assets.find((item) => item.id === activeShot.lastFrameAssetId) : undefined, [assets, activeShot]);
  const activeShotReferenceVideoAsset = useMemo(() => activeShot?.referenceVideoAssetId ? assets.find((item) => item.id === activeShot.referenceVideoAssetId) : undefined, [assets, activeShot]);
  const shotImageRefs = useMemo(() => shotReferenceAssets.filter((item) => item.type === "image" && !isStoryboardSketchAsset(item) && VIDEO_REFERENCE_ROLES.has(item.role || "reference_image")).map((item) => item.publicId || item.url), [shotReferenceAssets]);
  const shotImageRoles = useMemo(() => shotReferenceAssets.filter((item) => item.type === "image" && !isStoryboardSketchAsset(item) && VIDEO_REFERENCE_ROLES.has(item.role || "reference_image")).map((item) => (item.role === "first_frame" || item.role === "last_frame" ? item.role : "reference_image") as "reference_image" | "first_frame" | "last_frame"), [shotReferenceAssets]);
  const shotVideoRefs = useMemo(() => shotReferenceAssets.filter((item) => item.type === "video").map((item) => item.publicId || item.url), [shotReferenceAssets]);
  const shotStats = useMemo(() => ({
    total: storyboardShots.length,
    readyImages: storyboardShots.filter((shot) => shot.imageAssetIds.length > 0 || shot.status === "image_ready" || shot.status === "video_ready").length,
    readyVideos: storyboardShots.filter((shot) => shot.videoAssetIds.length > 0 || shot.status === "video_ready").length,
    failed: storyboardShots.filter((shot) => shot.status === "failed").length,
    pendingJobs: generationJobs.filter((job) => job.status === "pending").length,
  }), [storyboardShots, generationJobs]);

  const queuedSketchShots = useMemo(() => {
    const base = storyboardShots.filter(
      (shot) =>
        [shot.imagePrompt, shot.scene, shot.title]
          .concat(shot.characters, shot.shotType || "", shot.cameraMove || "", shot.purpose || "")
          .join(" ")
          .trim()
          .length > 0,
    );
    const filtered = batchMode === "missing"
      ? base.filter((shot) => !assets.some((asset) => shot.imageAssetIds.includes(asset.id) && isStoryboardSketchAsset(asset)))
      : batchMode === "failed"
        ? base.filter((shot) => shot.status === "failed")
        : base;
    return filtered.slice(0, Math.max(1, batchLimit));
  }, [storyboardShots, assets, batchMode, batchLimit]);

  const queuedImageShots = useMemo(() => {
    const base = storyboardShots.filter(
      (shot) => [shot.imagePrompt, shot.scene, shot.title]
        .concat(shot.characters, shot.shotType || "", shot.cameraMove || "", shot.purpose || "")
        .join(" ")
        .trim()
        .length > 0,
    );
    const filtered = batchMode === "missing"
      ? base.filter((shot) => !assets.some((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image" && !isStoryboardSketchAsset(asset)))
      : batchMode === "failed"
        ? base.filter((shot) => shot.status === "failed")
        : base;
    return filtered.slice(0, Math.max(1, batchLimit));
  }, [storyboardShots, assets, batchMode, batchLimit]);

  const queuedVideoShots = useMemo(() => {
    const base = storyboardShots.filter((shot) => (shot.videoPrompt || shot.imagePrompt).trim());
    const filtered = batchMode === "missing"
      ? base.filter((shot) => shot.videoAssetIds.length === 0)
      : batchMode === "failed"
        ? base.filter((shot) => shot.status === "failed")
        : base;
    return filtered.slice(0, Math.max(1, batchLimit));
  }, [storyboardShots, batchMode, batchLimit]);


  const workflowOutput = useMemo(() => {
    if (workflowMode === "novel") return workflowNovel;
    if (workflowMode === "script") return workflowScript;
    if (workflowMode === "assets") return workflowAssets;
    if (workflowMode === "storyboardVideo") return workflowStoryboardVideo;
    return workflowStoryboardImage;
  }, [workflowMode, workflowNovel, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage]);

  const setWorkflowOutput = (mode: WorkflowMode, value: string) => {
    if (mode === "novel") setWorkflowNovel(value);
    else if (mode === "script") setWorkflowScript(value);
    else if (mode === "assets") setWorkflowAssets(value);
    else if (mode === "storyboardVideo") setWorkflowStoryboardVideo(value);
    else setWorkflowStoryboardImage(value);
  };

  const buildWorkflowInput = (mode: WorkflowMode) => {
    if (mode === "novel") return workflowIdea.trim();
    if (mode === "script") {
      const excerpt = scriptSourceExcerpt.trim();
      const instruction = scriptAdaptationInstruction.trim();
      const source = excerpt || workflowIdea.trim();
      if (!source) return "";
      return `【本集大概内容】\n${source}\n\n【剧本生成要求】\n${instruction || "改成适合竖屏漫剧的一集/一段影视剧本；只基于上面的本集大概内容生成，不读取、不等待、不假设整本小说素材。"}`;
    }
    if (mode === "assets") return workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim();
    if (mode === "storyboardVideo") return `【剧本】\n${workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim()}\n\n【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}`;
    return `【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}\n\n【分镜/剧本】\n${workflowStoryboardVideo.trim() || workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim()}`;
  };


  const generateWorkflow = async (mode: WorkflowMode) => {
    const input = buildWorkflowInput(mode);
    if (!input.trim()) {
      toast.error(t("seedreamBeta.workflow.inputRequired"));
      return null;
    }
    setWorkflowGenerating(mode);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: mode === "script" ? WORKFLOW_DRAFT_MODEL : WORKFLOW_MODEL,
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: workflowSystemPrompt(mode) },
            { role: "user", content: input },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const contentType = response.headers.get("content-type") || "";
      const raw = contentType.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const clean = stripWorkflowText(raw);
      setWorkflowOutput(mode, clean);
      if (mode === "assets") {
        const parsedAssets = parseSemanticAssets(clean);
        if (parsedAssets.length > 0) {
          setSemanticAssets(parsedAssets);
          setActiveSemanticAssetId((prev) => prev || parsedAssets[0]?.id);
        }
      }
      if (mode === "storyboardVideo" || mode === "storyboardImage") {
        const parsedShots = parseStoryboardShots(clean);
        if (parsedShots.length > 0) {
          let nextActiveShotId = parsedShots[0]?.id;
          setStoryboardShots((prev) => {
            const next = !prev.length ? parsedShots : parsedShots.map((shot, index) => ({
              ...prev[index],
              ...shot,
              id: prev[index]?.id || shot.id,
              referenceAssetIds: prev[index]?.referenceAssetIds || shot.referenceAssetIds,
              imageAssetIds: prev[index]?.imageAssetIds || [],
              videoAssetIds: prev[index]?.videoAssetIds || [],
              status: prev[index]?.status || shot.status,
              imagePrompt: shot.imagePrompt || prev[index]?.imagePrompt || "",
              videoPrompt: shot.videoPrompt || prev[index]?.videoPrompt || "",
            }));
            nextActiveShotId = next[0]?.id;
            return next;
          });
          setActiveShotId((prev) => prev || nextActiveShotId);
          toast.success(`已生成文字分镜，并自动解析为 ${parsedShots.length} 张镜头卡`);
          return clean;
        }
      }
      toast.success(t("seedreamBeta.workflow.generated"));
      return clean;
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: t("seedreamBeta.workflow.failed") }));
      return null;
    } finally {
      setWorkflowGenerating(null);
    }
  };

  const ensureWorkflowScript = async () => {
    const existing = workflowScript.trim();
    if (existing) return existing;
    if (!(scriptSourceExcerpt.trim() || workflowIdea.trim())) {
      toast.error("先输入本集剧情，可以是短描述、梗概或小说片段");
      return "";
    }
    toast.message("正在根据本集剧情输入生成剧本…");
    const generated = await generateWorkflow("script");
    return generated?.trim() || "";
  };

  const chatAboutScript = async () => {
    const question = scriptChatInput.trim();
    if (!question) {
      toast.error("先输入想聊什么");
      return;
    }
    const baseScript = await ensureWorkflowScript();
    if (!baseScript) return;
    const userMessage: ScriptChatMessage = { id: `u-${Date.now()}`, role: "user", content: question };
    const assistantId = `a-${Date.now()}`;
    setScriptChatInput("");
    setScriptChatMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setScriptChatting(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: WORKFLOW_POLISH_MODEL,
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: "你是影视剧本精修顾问。负责强钩子、节奏、对白、人物动机和悬念升级；只讨论剧本问题、给修改建议和可选方案；不要直接重写完整剧本，除非用户明确要求。输出简洁、具体、可执行。" },
            { role: "user", content: `【当前剧本】
${baseScript}

【用户想聊的问题】
${question}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      setScriptChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: stripWorkflowText(raw) } : msg));
    } catch (err) {
      const message = getErrorMessage(err, { module: "chat", fallbackMessage: "剧本讨论失败" });
      toast.error(message);
      setScriptChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: `失败：${message}` } : msg));
    } finally {
      setScriptChatting(false);
    }
  };

  const reviseScriptWithInstruction = async (overrideInstruction?: string) => {
    const instruction = (overrideInstruction ?? scriptRevisionInstruction).trim();
    if (!instruction) {
      toast.error("先输入要怎么改剧本");
      return;
    }
    const baseScript = await ensureWorkflowScript();
    if (!baseScript) return;
    setScriptRevising(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: WORKFLOW_POLISH_MODEL,
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: "你是影视剧本精修改稿助手。重点负责强钩子、对白重写、节奏压缩、人物动机和悬念升级；严格根据用户修改意见重写剧本；保留未要求改动的剧情、人物关系和已定台词。只输出修改后的完整剧本，不要解释，不要 Markdown 代码块。" },
            { role: "user", content: `【当前剧本】
${baseScript}

【修改意见】
${instruction}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      setWorkflowScript(stripWorkflowText(raw));
      setWorkflowMode("script");
      if (!overrideInstruction) setScriptRevisionInstruction("");
      toast.success("剧本已按修改意见更新");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "修改剧本失败" }));
    } finally {
      setScriptRevising(false);
    }
  };

  const chatAboutAsset = async (asset: SemanticAsset) => {
    const question = assetChatInput.trim();
    if (!question) {
      toast.error("先输入想聊什么");
      return;
    }
    const userMessage: ScriptChatMessage = { id: `asset-u-${Date.now()}`, role: "user", content: question };
    const assistantId = `asset-a-${Date.now()}`;
    setAssetChatInput("");
    setAssetChatMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setAssetChatting(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: WORKFLOW_MODEL,
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: "你是 Seedream/Seedance 资产设定顾问。只讨论当前资产，给修改建议、风险和可选方向；不要直接覆盖资产字段。输出简洁、具体、可执行。" },
            { role: "user", content: `【剧本】
${workflowScript || workflowNovel || workflowIdea}

【当前资产】
类型：${getSemanticAssetKindLabel(asset.kind)}
名称：${asset.name}
摘要：${asset.summary}
锁定词：${asset.lockPrompt}
禁用项：${asset.negativePrompt || ""}

【用户想聊的问题】
${question}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      setAssetChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: stripWorkflowText(raw) } : msg));
    } catch (err) {
      const message = getErrorMessage(err, { module: "chat", fallbackMessage: "资产讨论失败" });
      toast.error(message);
      setAssetChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: `失败：${message}` } : msg));
    } finally {
      setAssetChatting(false);
    }
  };

  const regenerateSemanticAsset = async (asset: SemanticAsset) => {
    const instruction = assetRegenerateInstruction.trim();
    setAssetRegeneratingId(asset.id);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: WORKFLOW_MODEL,
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: '你是 Seedream/Seedance 前期资产设定助手。根据剧本、当前资产和用户补充要求，重新生成单个资产。只输出 JSON，不要代码块。格式：{"summary":"","lock_prompt":"","negative_prompt":""}' },
            { role: "user", content: `【剧本】
${workflowScript || workflowNovel || workflowIdea}

【资产类型】${getSemanticAssetKindLabel(asset.kind)}
【资产名称】${asset.name}
【当前摘要】
${asset.summary}

【当前锁定词】
${asset.lockPrompt}

【当前禁用项】
${asset.negativePrompt || ""}

【重生成要求】
${instruction || "在保持角色/场景/道具/风格定位不变的前提下，补全更可执行、更稳定的描述、锁定词和禁用项。"}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const clean = stripWorkflowText(raw);
      let parsed: any = null;
      try { parsed = JSON.parse(stripJsonFence(clean)); } catch {}
      updateSemanticAsset(asset.id, {
        summary: parsed?.summary || parsed?.description || clean,
        lockPrompt: parsed?.lock_prompt || parsed?.lockPrompt || parsed?.prompt || asset.lockPrompt,
        negativePrompt: parsed?.negative_prompt || parsed?.negativePrompt || asset.negativePrompt || "",
      });
      setAssetRegenerateInstruction("");
      toast.success("资产描述已重新生成");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "重生成资产失败" }));
    } finally {
      setAssetRegeneratingId(null);
    }
  };

  const copyWorkflowOutput = async () => {
    if (!workflowOutput.trim()) return;
    await navigator.clipboard.writeText(workflowOutput);
    toast.success(t("seedreamBeta.workflow.copied"));
  };

  const sendWorkflowToImage = () => {
    if (!workflowOutput.trim()) return;
    setImagePrompt(workflowOutput.trim());
    setTab("image");
    toast.success(t("seedreamBeta.workflow.sentToImage"));
  };

  const sendWorkflowToVideo = () => {
    if (!workflowOutput.trim()) return;
    setVideoPrompt(workflowOutput.trim());
    setTab("video");
    toast.success(t("seedreamBeta.workflow.sentToVideo"));
  };

  const handleAssetUpload = async (file: File) => {
    setUploadingAsset(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const response = await fetch("/api/files/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) throw await readApiError(response);
      const data = await response.json();
      const publicId = data.public_id || data.url || data.image_url;
      const kind = getAssetKind(data.mime_type || file.type, data.filename || file.name);
      const nextAsset: StoredAsset = {
        id: `${publicId}-${Date.now()}`,
        publicId,
        name: data.filename || file.name,
        type: kind,
        mimeType: data.mime_type || file.type,
        size: data.size || file.size,
        url: assetViewUrl(publicId),
        createdAt: new Date().toISOString(),
      };
      setAssets((prev) => [nextAsset, ...prev]);
      setSelectedAssetIds((prev) => Array.from(new Set([nextAsset.id, ...prev])));
      toast.success(t("seedreamBeta.assets.uploaded"));
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "file", fallbackMessage: t("seedreamBeta.assets.uploadFailed") }));
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleAssetFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    files.forEach((file) => handleAssetUpload(file));
  };

  const toggleAssetSelection = (id: string) => {
    setSelectedAssetIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const removeAsset = (id: string) => {
    setAssets((prev) => prev.filter((item) => item.id !== id));
    setSelectedAssetIds((prev) => prev.filter((item) => item !== id));
    setSemanticAssets((prev) => prev.map((asset) => ({
      ...asset,
      linkedAssetIds: asset.linkedAssetIds.filter((item) => item !== id),
    })));
    setStoryboardShots((prev) => prev.map((shot) => ({
      ...shot,
      referenceAssetIds: shot.referenceAssetIds.filter((item) => item !== id),
      imageAssetIds: shot.imageAssetIds.filter((item) => item !== id),
      videoAssetIds: shot.videoAssetIds.filter((item) => item !== id),
      firstFrameAssetId: shot.firstFrameAssetId === id ? undefined : shot.firstFrameAssetId,
      referenceVideoAssetId: shot.referenceVideoAssetId === id ? undefined : shot.referenceVideoAssetId,
    })));
    toast.success("已删除素材并解除所有引用");
  };

  const addLatestImageToAssets = () => {
    if (!lastImage?.image_url) return;
    const nextAsset: StoredAsset = {
      id: `image-${lastImage.id}-${Date.now()}`,
      publicId: lastImage.image_url,
      name: `Seedream #${lastImage.id}`,
      type: "image",
      url: assetViewUrl(lastImage.image_url),
      createdAt: new Date().toISOString(),
    };
    setAssets((prev) => [nextAsset, ...prev]);
    setSelectedAssetIds((prev) => Array.from(new Set([nextAsset.id, ...prev])));
    toast.success(t("seedreamBeta.assets.saved"));
  };

  const addLatestVideoToAssets = () => {
    if (!lastVideo?.video_url) return;
    const nextAsset: StoredAsset = {
      id: `video-${lastVideo.id}-${Date.now()}`,
      publicId: lastVideo.video_url,
      name: `Seedance #${lastVideo.id}`,
      type: "video",
      url: assetViewUrl(lastVideo.video_url),
      createdAt: new Date().toISOString(),
    };
    setAssets((prev) => [nextAsset, ...prev]);
    setSelectedAssetIds((prev) => Array.from(new Set([nextAsset.id, ...prev])));
    toast.success(t("seedreamBeta.assets.saved"));
  };


  const updateAssetRole = (id: string, role: AssetRole) => {
    setAssets((prev) => prev.map((asset) => asset.id === id ? { ...asset, role } : asset));
  };

  const updateShot = (id: string, patch: Partial<StoryboardShot>) => {
    setStoryboardShots((prev) => prev.map((shot) => shot.id === id ? { ...shot, ...patch } : shot));
  };

  const addShot = () => {
    const shot = createShot(storyboardShots.length + 1);
    setStoryboardShots((prev) => [...prev, shot]);
    setActiveShotId(shot.id);
  };

  const deleteShot = (id: string) => {
    setStoryboardShots((prev) => prev.filter((shot) => shot.id !== id).map((shot, index) => ({ ...shot, index: index + 1 })));
    if (activeShotId === id) setActiveShotId(storyboardShots.find((shot) => shot.id !== id)?.id);
  };

  const rebuildShotsFromOutputs = () => {
    const parsed = parseStoryboardShots(workflowStoryboardImage.trim() || workflowStoryboardVideo.trim());
    if (!parsed.length) {
      toast.error("没有可解析的分镜输出，请先生成视频/图片分镜提示词");
      return;
    }
    setStoryboardShots(parsed);
    setActiveShotId(parsed[0]?.id);
    toast.success(`已生成 ${parsed.length} 张镜头卡`);
  };

  const rebuildSemanticAssetsFromOutput = () => {
    const parsed = parseSemanticAssets(workflowAssets.trim());
    if (!parsed.length) {
      toast.error("没有可解析的资产输出，请先生成资产文本");
      return;
    }
    setSemanticAssets(parsed);
    setActiveSemanticAssetId(parsed[0]?.id);
    toast.success(`已生成 ${parsed.length} 个语义资产`);
  };

  const addSemanticAsset = (kind: SemanticAssetKind = "character") => {
    const asset: SemanticAsset = {
      id: `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name: `新${getSemanticAssetKindLabel(kind)}`,
      summary: "",
      lockPrompt: "",
      negativePrompt: "",
      linkedAssetIds: [],
      createdAt: new Date().toISOString(),
    };
    setSemanticAssets((prev) => [asset, ...prev]);
    setActiveSemanticAssetId(asset.id);
    setAssetKindFilter(kind);
    toast.success(`已新增${getSemanticAssetKindLabel(kind)}资产`);
  };

  const updateSemanticAsset = (id: string, patch: Partial<SemanticAsset>) => {
    setSemanticAssets((prev) => prev.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
  };

  const deleteSemanticAsset = (id: string) => {
    setSemanticAssets((prev) => prev.filter((asset) => asset.id !== id));
    setStoryboardShots((prev) => prev.map((shot) => ({ ...shot, semanticAssetIds: shot.semanticAssetIds.filter((item) => item !== id) })));
    if (activeSemanticAssetId === id) setActiveSemanticAssetId(semanticAssets.find((item) => item.id !== id)?.id);
  };

  const toggleSemanticLinkedAsset = (semanticId: string, assetId: string) => {
    setSemanticAssets((prev) => prev.map((asset) => {
      if (asset.id !== semanticId) return asset;
      const linkedAssetIds = asset.linkedAssetIds.includes(assetId) ? asset.linkedAssetIds.filter((id) => id !== assetId) : [...asset.linkedAssetIds, assetId];
      return { ...asset, linkedAssetIds };
    }));
  };

  const toggleShotSemanticAsset = (shotId: string, semanticId: string) => {
    setStoryboardShots((prev) => prev.map((shot) => {
      if (shot.id !== shotId) return shot;
      const semanticAssetIds = shot.semanticAssetIds.includes(semanticId) ? shot.semanticAssetIds.filter((id) => id !== semanticId) : [...shot.semanticAssetIds, semanticId];
      return { ...shot, semanticAssetIds };
    }));
  };

  const applySemanticAssetsToShotPrompts = (shot: StoryboardShot) => {
    const selected = semanticAssets.filter((asset) => shot.semanticAssetIds.includes(asset.id));
    const lock = buildSemanticLockPrompt(selected);
    if (!lock.trim()) {
      toast.error("先给镜头绑定角色/场景/道具/风格资产");
      return;
    }
    const prefix = `【一致性资产锁定】\n${lock}\n\n`;
    const stripOld = (value: string) => value.replace(/^【一致性资产锁定】[\s\S]*?\n\n/, "");
    updateShot(shot.id, {
      imagePrompt: `${prefix}${stripOld(shot.imagePrompt || "")}`.trim(),
      videoPrompt: `${prefix}${stripOld(shot.videoPrompt || "")}`.trim(),
    });
    toast.success("已注入资产锁定词");
  };

  const toggleShotAsset = (shotId: string, assetId: string) => {
    setStoryboardShots((prev) => prev.map((shot) => {
      if (shot.id !== shotId) return shot;
      const next = shot.referenceAssetIds.includes(assetId)
        ? shot.referenceAssetIds.filter((id) => id !== assetId)
        : [...shot.referenceAssetIds, assetId];
      return { ...shot, referenceAssetIds: next };
    }));
  };

  const setShotSpecialAsset = (shotId: string, key: "firstFrameAssetId" | "lastFrameAssetId" | "referenceVideoAssetId", assetId: string) => {
    setStoryboardShots((prev) => prev.map((shot) => {
      if (shot.id !== shotId) return shot;
      const nextId = assetId || undefined;
      const referenceAssetIds = nextId ? Array.from(new Set([...shot.referenceAssetIds, nextId])) : shot.referenceAssetIds;
      return { ...shot, [key]: nextId, referenceAssetIds };
    }));
  };

  const sendShotToImage = (shot: StoryboardShot) => {
    setImagePrompt(buildImagePromptForGeneration(shot));
    setImageAspect(shot.aspectRatio || imageAspect);
    setSelectedAssetIds(shot.referenceAssetIds);
    setActiveShotId(shot.id);
    setTab("image");
  };

  const sendShotToVideo = (shot: StoryboardShot) => {
    setVideoPrompt(shot.videoPrompt || shot.imagePrompt);
    setVideoAspect(shot.aspectRatio || videoAspect);
    setVideoDuration(shot.duration || videoDuration);
    setSelectedAssetIds(shot.referenceAssetIds);
    setActiveShotId(shot.id);
    setTab("video");
  };

  const createAssetFromImage = (image: GeneratedImage, shot?: StoryboardShot, semanticAsset?: SemanticAsset, intent: GenerationJob["intent"] = "shot_image"): StoredAsset | null => {
    if (!image.image_url) return null;
    const isSketch = intent === "storyboard_sketch";
    return {
      id: `image-${image.id}-${Date.now()}`,
      publicId: image.image_url,
      name: semanticAsset
        ? `${semanticAsset.name}-资产图`
        : shot
          ? `${shot.index.toString().padStart(2, "0")}-${shot.title}-${isSketch ? "故事版草稿" : "分镜图"}`
          : `Seedream #${image.id}`,
      type: "image",
      role: semanticAsset?.kind || (isSketch ? "reference_image" : "first_frame"),
      shotId: shot?.id,
      source: isSketch ? "storyboard_sketch" : "seedream",
      url: assetViewUrl(image.image_url),
      createdAt: new Date().toISOString(),
    };
  };

  const createAssetFromVideo = (video: VideoGeneration, shot?: StoryboardShot): StoredAsset | null => {
    if (!video.video_url) return null;
    return {
      id: `video-${video.id}-${Date.now()}`,
      publicId: video.video_url,
      name: shot ? `${shot.index.toString().padStart(2, "0")}-${shot.title}-视频` : `Seedance #${video.id}`,
      type: "video",
      role: "reference_video",
      shotId: shot?.id,
      source: "seedance",
      url: assetViewUrl(video.video_url),
      createdAt: new Date().toISOString(),
    };
  };

  const addGenerationJob = (job: GenerationJob) => {
    setGenerationJobs((prev) => [job, ...prev]);
  };

  const buildSemanticAssetImagePrompt = (asset: SemanticAsset) => {
    const kindLabel = getSemanticAssetKindLabel(asset.kind);
    const base = [
      `【资产类型】${kindLabel}`,
      `【资产名称】${asset.name}`,
      asset.summary ? `【摘要】${asset.summary}` : "",
      asset.lockPrompt ? `【Seedream 资产锁定词】${asset.lockPrompt}` : "",
      "生成一张可作为漫剧制作资产库使用的清晰参考图。主体单一、特征稳定、构图干净、方便后续作为参考图复用。",
      asset.kind === "character" ? "角色资产：单人正面或三分之二视角，完整外观、服装、发型、年龄气质清晰，背景简洁。" : "",
      asset.kind === "scene" ? "场景资产：无人或弱人物干扰，空间结构、光线、关键物件位置清晰。" : "",
      asset.kind === "prop" ? "道具资产：单个道具居中展示，材质、形状、使用痕迹清晰，背景干净。" : "",
      asset.kind === "style" ? "风格资产：建立统一美术风格、色彩、光影和质感，不要复杂叙事。" : "",
      asset.negativePrompt ? `【禁用项】${asset.negativePrompt}` : "",
    ];
    return base.filter(Boolean).join("\n");
  };

  const generateSemanticAssetImage = async (asset: SemanticAsset) => {
    const prompt = buildSemanticAssetImagePrompt(asset).trim();
    if (!prompt) return toast.error("资产缺少可用于生图的描述");
    setAssetImageGeneratingId(asset.id);
    try {
      // 资产图生成必须走 Seedream 文生图。不要自动把已有资产图作为 reference_image_urls 传入：
      // 当前后端一旦收到参考图会进入图片编辑链路，而不是 Seedream 文生图，导致已有资产“重新生成”稳定失败。
      const data = await generateImage(prompt, "1:1", imageResolution, SEEDREAM_IMAGE_QUALITY, [], "seedream");
      setLastImageId(data.id);
      addGenerationJob({ id: `job-asset-image-${data.id}-${Date.now()}`, semanticAssetId: asset.id, type: "image", mediaId: data.id, prompt, status: "pending", intent: "asset_image", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      toast.success("已提交资产图生成任务，完成后会自动关联到该资产");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: "资产图生成失败" }));
    } finally {
      setAssetImageGeneratingId(null);
    }
  };

  const buildStoryboardSketchPrompt = (shot: StoryboardShot) => {
    const source = [
      `分镜${shot.index}：${shot.title}`,
      shot.shotType ? `景别：${shot.shotType}` : "",
      shot.cameraMove ? `运镜：${shot.cameraMove}` : "",
      shot.scene ? `画面内容：${shot.scene}` : "",
      shot.characters.length ? `出场人物：${shot.characters.join("、")}` : "",
      shot.dialogue ? `关键对白：${shot.dialogue}` : "",
      shot.imagePrompt ? `补充描述：${shot.imagePrompt}` : "",
    ].filter(Boolean).join("\n");
    return `根据以下分镜内容绘制故事版草稿图。\n风格要求：松散随性草稿线，黑白单色线稿，低细节，像导演分镜板；只用少量彩色手绘箭头标注运动轨迹、视线方向和动作方向；不要做精修插画，不要电影海报，不要复杂上色，不要清晰可读字幕。\n构图要求：重点验证人物站位、空间关系、景别、运镜方向和动作可读性。\n\n${source}`;
  };

  const buildImagePromptForGeneration = (shot: StoryboardShot) => {
    const directorBlock = findDirectorBlockForShot(directorBlocks, shot.id);
    const base = shot.imagePrompt?.trim() || "";
    if (base) return injectDirectorBlockToPrompt(base, directorBlock, semanticAssets);
    const structured = [
      `分镜${shot.index}：${shot.title}`,
      shot.scene ? `画面场景：${shot.scene}` : "",
      shot.shotType ? `景别：${shot.shotType}` : "",
      shot.cameraMove ? `运镜：${shot.cameraMove}` : "",
      shot.characters.length ? `出场人物：${shot.characters.join("、")}` : "",
      shot.dialogue ? `关键对白：${shot.dialogue}` : "",
      shot.purpose ? `目的：${shot.purpose}` : "",
    ].filter(Boolean).join("\n");
    return structured ? injectDirectorBlockToPrompt(structured, directorBlock, semanticAssets) : "";
  };

  const generateShotImage = async (shot: StoryboardShot, entryPath: "single" | "batch" = "single") => {
    const prompt = buildImagePromptForGeneration(shot);
    if (!prompt) {
      toast.error("镜头缺少分镜图提示词");
      return null;
    }
    setActiveShotId(shot.id);
    updateShot(shot.id, { status: "image_generating" });
    const refs = assets.filter((asset) => shot.referenceAssetIds.includes(asset.id) && asset.type === "image").map((asset) => asset.publicId || asset.url);
    try {
      const data = await generateImage(prompt, shot.aspectRatio || imageAspect, imageResolution, SEEDREAM_IMAGE_QUALITY, refs, "seedream");
      setLastImageId(data.id);
      addGenerationJob({ id: `job-image-${data.id}-${Date.now()}`, shotId: shot.id, type: "image", mediaId: data.id, prompt, status: "pending", intent: "shot_image", entryPath, promptSource: shot.imagePrompt.trim() ? "imagePrompt" : "structuredFallback", directorInjected: Boolean(findDirectorBlockForShot(directorBlocks, shot.id)), referenceImageCount: refs.length, referenceVideoCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      updateShot(shot.id, { status: "image_generating" });
      return data;
    } catch (err) {
      updateShot(shot.id, { status: "failed" });
      throw err;
    }
  };

  const generateShotSketch = async (shot: StoryboardShot, entryPath: "single" | "batch" = "single") => {
    const prompt = buildStoryboardSketchPrompt(shot);
    setActiveShotId(shot.id);
    try {
      const data = await generateImage(prompt, shot.aspectRatio || imageAspect, imageResolution, "standard", [], "seedream");
      setLastImageId(data.id);
      addGenerationJob({ id: `job-sketch-${data.id}-${Date.now()}`, shotId: shot.id, type: "image", mediaId: data.id, prompt, status: "pending", intent: "storyboard_sketch", entryPath, promptSource: "storyboardSketch", directorInjected: false, referenceImageCount: 0, referenceVideoCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      toast.success("已提交故事版草稿图任务");
      return data;
    } catch (err) {
      updateShot(shot.id, { status: "failed" });
      throw err;
    }
  };

  const generateShotVideo = async (shot: StoryboardShot, entryPath: "single" | "batch" = "single") => {
    const rawPrompt = (shot.videoPrompt || shot.imagePrompt).trim();
    const prompt = injectDirectorBlockToPrompt(rawPrompt, findDirectorBlockForShot(directorBlocks, shot.id), semanticAssets);
    if (!prompt) {
      toast.error("镜头缺少视频提示词");
      return null;
    }
    setActiveShotId(shot.id);
    updateShot(shot.id, { status: "video_generating" });
    const refs = getShotAssets(shot, assets);
    const imageAssets = refs.filter((asset) => asset.type === "image" && !isStoryboardSketchAsset(asset) && VIDEO_REFERENCE_ROLES.has(asset.role || "reference_image"));
    const videoAssets = refs.filter((asset) => asset.type === "video");
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: shot.aspectRatio || videoAspect,
        duration: shot.duration || videoDuration,
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: imageAssets.map((asset) => asset.publicId || asset.url),
        reference_image_roles: imageAssets.map((asset) => (asset.id === shot.firstFrameAssetId ? "first_frame" : asset.id === shot.lastFrameAssetId ? "last_frame" : asset.role === "first_frame" || asset.role === "last_frame" ? asset.role : "reference_image") as "reference_image" | "first_frame" | "last_frame"),
        reference_video_urls: videoAssets.map((asset) => asset.publicId || asset.url),
      });
      setLastVideoId(data.id);
      addGenerationJob({ id: `job-video-${data.id}-${Date.now()}`, shotId: shot.id, type: "video", mediaId: data.id, prompt, status: "pending", entryPath, promptSource: shot.videoPrompt.trim() ? "videoPrompt" : "imagePromptFallback", directorInjected: Boolean(findDirectorBlockForShot(directorBlocks, shot.id)), referenceImageCount: imageAssets.length, referenceVideoCount: videoAssets.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return data;
    } catch (err) {
      updateShot(shot.id, { status: "failed" });
      throw err;
    }
  };

  const batchGenerateSketches = async () => {
    const queue = queuedSketchShots;
    if (!queue.length) return toast.error(batchMode === "missing" ? "没有缺故事版草稿的镜头" : batchMode === "failed" ? "没有失败镜头可重试" : "没有可生成草稿图的镜头");
    batchCancelRef.current = false;
    setBatchGenerating("sketches");
    try {
      for (const shot of queue) {
        if (batchCancelRef.current) break;
        await generateShotSketch(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量故事版草稿图提交" : `已提交 ${queue.length} 个故事版草稿图任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: "批量故事版草稿图提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const batchGenerateImages = async () => {
    const queue = queuedImageShots;
    if (!queue.length) return toast.error(batchMode === "missing" ? "没有缺图镜头" : batchMode === "failed" ? "没有失败镜头可重试" : "没有可生成的镜头图提示词");
    batchCancelRef.current = false;
    setBatchGenerating("images");
    try {
      for (const shot of queue) {
        if (batchCancelRef.current) break;
        await generateShotImage(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量分镜图提交" : `已提交 ${queue.length} 个分镜图任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: "批量分镜图提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const batchGenerateVideos = async () => {
    const queue = queuedVideoShots;
    if (!queue.length) return toast.error(batchMode === "missing" ? "没有缺视频镜头" : batchMode === "failed" ? "没有失败镜头可重试" : "没有可生成的视频提示词");
    batchCancelRef.current = false;
    setBatchGenerating("videos");
    try {
      for (const shot of queue) {
        if (batchCancelRef.current) break;
        await generateShotVideo(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量视频提交" : `已提交 ${queue.length} 个视频任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "video", fallbackMessage: "批量视频提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const batchGenerateSketchesForShots = async (targets: StoryboardShot[]) => {
    if (!targets.length) return toast.error("没有选中的镜头可生成草稿图");
    batchCancelRef.current = false;
    setBatchGenerating("sketches");
    try {
      for (const shot of targets) {
        if (batchCancelRef.current) break;
        await generateShotSketch(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量故事版草稿图提交" : `已提交 ${targets.length} 个故事版草稿图任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: "批量故事版草稿图提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const batchGenerateImagesForShots = async (targets: StoryboardShot[]) => {
    if (!targets.length) return toast.error("没有选中的镜头可生成正式图");
    batchCancelRef.current = false;
    setBatchGenerating("images");
    try {
      for (const shot of targets) {
        if (batchCancelRef.current) break;
        await generateShotImage(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量分镜图提交" : `已提交 ${targets.length} 个分镜图任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: "批量分镜图提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const batchGenerateVideosForShots = async (targets: StoryboardShot[]) => {
    if (!targets.length) return toast.error("没有选中的镜头可生成视频");
    batchCancelRef.current = false;
    setBatchGenerating("videos");
    try {
      for (const shot of targets) {
        if (batchCancelRef.current) break;
        await generateShotVideo(shot, "batch");
      }
      toast.success(batchCancelRef.current ? "已暂停批量视频提交" : `已提交 ${targets.length} 个视频任务`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "video", fallbackMessage: "批量视频提交失败" }));
    } finally {
      setBatchGenerating(null);
      batchCancelRef.current = false;
    }
  };

  const pauseBatchGeneration = () => {
    batchCancelRef.current = true;
    toast.message("正在暂停，当前任务提交完成后停止");
  };

  const retryFailedShots = () => {
    setBatchMode("failed");
    setBatchLimit(Math.max(1, storyboardShots.filter((shot) => shot.status === "failed").length || batchLimit));
    toast.message("已切到失败重试队列，可选择批量分镜图或批量视频");
  };

  const ensureDirectorBlockForShot = (shot: StoryboardShot) => {
    const existing = findDirectorBlockForShot(directorBlocks, shot.id);
    if (existing) return existing;
    const created = createDefaultDirectorBlock(shot.id, getSceneAssetForShot(shot, semanticAssets));
    setDirectorBlocks((prev) => [created, ...prev]);
    return created;
  };

  const updateDirectorBlock = (block: DirectorBlock) => {
    setDirectorBlocks((prev) => {
      const exists = prev.some((item) => item.id === block.id || item.shotId === block.shotId);
      if (!exists) return [block, ...prev];
      return prev.map((item) => (item.id === block.id || item.shotId === block.shotId ? block : item));
    });
  };

  const mergeDirectorBlocks = (blocks: DirectorBlock[]) => {
    if (!blocks.length) return;
    const targetIds = new Set(blocks.map((block) => block.shotId));
    setDirectorBlocks((prev) => [...blocks, ...prev.filter((block) => !targetIds.has(block.shotId))]);
  };

  const copyDirectorBlockFromShotToTargets = (sourceShotId: string, targetShotIds: string[], successMessage: string) => {
    const sourceBlock = findDirectorBlockForShot(directorBlocks, sourceShotId);
    if (!sourceBlock) {
      toast.error("源镜头还没有导演台设置");
      return;
    }
    const uniqueTargets = Array.from(new Set(targetShotIds.filter((id) => id && id !== sourceShotId)));
    if (!uniqueTargets.length) {
      toast.error("没有可应用的目标镜头");
      return;
    }
    mergeDirectorBlocks(copyDirectorBlockToShots(sourceBlock, uniqueTargets, { keepCharacterPositions: true }));
    toast.success(successMessage);
  };

  const inheritDirectorBlockFromPrevious = () => {
    if (!activeShot) return;
    const activeIndex = storyboardShots.findIndex((shot) => shot.id === activeShot.id);
    const previousShot = activeIndex > 0 ? storyboardShots[activeIndex - 1] : undefined;
    if (!previousShot) {
      toast.error("当前已经是第一个镜头");
      return;
    }
    copyDirectorBlockFromShotToTargets(previousShot.id, [activeShot.id], `已从镜头 ${previousShot.index} 继承导演台`);
    setShowDirectorPanel(true);
  };

  const applyDirectorBlockToFollowingShots = () => {
    if (!activeShot) return;
    const activeIndex = storyboardShots.findIndex((shot) => shot.id === activeShot.id);
    const targetShotIds = activeIndex >= 0 ? storyboardShots.slice(activeIndex + 1).map((shot) => shot.id) : [];
    copyDirectorBlockFromShotToTargets(activeShot.id, targetShotIds, `已应用到后续 ${targetShotIds.length} 个镜头`);
  };

  const applyDirectorBlockToSelectedShots = () => {
    if (!activeShot) return;
    const targetShotIds = selectedOverviewShotIds.filter((id) => id !== activeShot.id);
    copyDirectorBlockFromShotToTargets(activeShot.id, targetShotIds, `已应用到选中的 ${targetShotIds.length} 个镜头`);
  };

  const toggleOverviewShotSelection = (shotId: string) => {
    setSelectedOverviewShotIds((prev) => prev.includes(shotId) ? prev.filter((id) => id !== shotId) : [...prev, shotId]);
  };

  const copyToClipboard = async (value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const submitImage = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error(t("seedreamBeta.promptRequired"));
      return;
    }
    try {
      const data = await generateImage(prompt, imageAspect, imageResolution, SEEDREAM_IMAGE_QUALITY, selectedImageRefs, "seedream");
      setLastImageId(data.id);
      toast.success(t("seedreamBeta.imageSubmitted"));
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: t("seedreamBeta.imageFailed") }));
    }
  };

  const submitVideo = async () => {
    const prompt = videoPrompt.trim();
    if (!prompt) {
      toast.error(t("seedreamBeta.promptRequired"));
      return;
    }
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: videoAspect,
        duration: videoDuration,
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: selectedImageRefs,
        reference_image_roles: selectedImageRefs.map(() => "reference_image" as const),
        reference_video_urls: selectedVideoRefs,
      });
      setLastVideoId(data.id);
      toast.success(t("seedreamBeta.videoSubmitted"));
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "video", fallbackMessage: t("seedreamBeta.videoFailed") }));
    }
  };

  const downloadImage = async (image: GeneratedImage) => {
    if (!image.image_url) return;
    try {
      const response = await fetch(image.image_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = `seedream-beta-${image.id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectURL);
    } catch {
      const link = document.createElement("a");
      link.href = image.image_url;
      link.download = `seedream-beta-${image.id}.png`;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  const autoLayoutNodes = useCallback(() => {
    if (storyboardShots.length === 0) return;
    const scenes = Array.from(new Set(storyboardShots.map((s) => s.scene || "未分组")));
    const shotsPerScene = scenes.map((scene) =>
      storyboardShots.filter((s) => (s.scene || "未分组") === scene)
    );
  const autoLayoutNodes = useCallback(() => {
    if (storyboardShots.length === 0) return;
    const scenes = Array.from(new Set(storyboardShots.map((s) => s.scene || "未分组")));
    const shotsPerScene = scenes.map((scene) =>
      storyboardShots.filter((s) => (s.scene || "未分组") === scene)
    );
    const newShots: StoryboardShot[] = [];
    let currentY = 40;
    const COL_WIDTH = 280;
    const ROW_HEIGHT = 200;
    const GAP_X = 40;
    const GAP_Y = 60;
    for (const sceneShots of shotsPerScene) {
      let currentX = 40;
      for (let i = 0; i < sceneShots.length; i++) {
        const shot = sceneShots[i];
        newShots.push({
          ...shot,
          index: newShots.length + 1,
        });
        currentX += COL_WIDTH + GAP_X;
      }
      currentY += ROW_HEIGHT + GAP_Y;
    }
    setStoryboardShots(newShots);
  }, [storyboardShots, setStoryboardShots]);
  }, [storyboardShots, setStoryboardShots]);

  return (
    <div className="fixed inset-0 z-50">
      <ManjuStudioLayout
        projectName={activeProject?.title || t("seedreamBeta.projects.newProject")}
        activeStep={workflowMode}
        onStepChange={(step) => {
          if (step === "overview") {
            setWorkflowView("overview");
          } else {
            setWorkflowMode(step as WorkflowMode);
            setWorkflowView("step");
          }
        }}
        onGenerate={(step) => {
          setWorkflowMode(step);
          setWorkflowView("step");
        }}
        generating={workflowGenerating}
        nodes={storyboardShots.map((shot, i) => ({
          id: shot.id,
          type: shot.videoAssetIds && shot.videoAssetIds.length > 0 ? "video" : shot.imageAssetIds && shot.imageAssetIds.length > 0 ? "image" : "shot",
          title: `${i + 1}. ${shot.title || shot.scene || "未命名镜头"}`,
          x: (i % 4) * 280 + 40,
          y: Math.floor(i / 4) * 200 + 40,
          width: 240,
          height: 160,
          status: shot.videoAssetIds && shot.videoAssetIds.length > 0 ? "done" : shot.imageAssetIds && shot.imageAssetIds.length > 0 ? "draft" : "empty",
          data: shot,
        }))}
        connections={storyboardShots.slice(0, -1).map((shot, i) => ({
          id: `conn-${i}`,
          from: shot.id,
          to: storyboardShots[i + 1].id,
        }))}
        onNodeDoubleClick={(node) => {
          const shot = storyboardShots.find((s) => s.id === node.id);
          if (shot) {
            setActiveShotId(shot.id);
            setWorkflowView("step");
          }
        }}
        onAutoLayout={autoLayoutNodes}
        onSave={() => toast.info("开发中")}
        onExport={() => toast.info("开发中")}
        onImport={() => toast.info("开发中")}
        onNewProject={() => toast.info("开发中")}
        onOpenProject={() => toast.info("开发中")}
        onSettings={() => toast.info("开发中")}
      >
        {workflowView === "step" && activeShotId ? (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                {storyboardShots.find((s) => s.id === activeShotId)?.title || "未命名镜头"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setActiveShotId(undefined);
                  setWorkflowView("overview");
                }}
                className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Shot 编辑表单 */}
            <div className="space-y-4">
              {/* 基础信息 */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-text-tertiary">标题</label>
                <input
                  type="text"
                  value={storyboardShots.find((s) => s.id === activeShotId)?.title || ""}
                  onChange={(e) => {
                    const title = e.target.value;
                    setStoryboardShots((prev) =>
                      prev.map((s) => (s.id === activeShotId ? { ...s, title } : s))
                    );
                  }}
                  className="w-full rounded-lg border border-surface-border bg-surface-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
                />
              </div>

              {/* 场景 */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-text-tertiary">场景</label>
                <input
                  type="text"
                  value={storyboardShots.find((s) => s.id === activeShotId)?.scene || ""}
                  onChange={(e) => {
                    const scene = e.target.value;
                    setStoryboardShots((prev) =>
                      prev.map((s) => (s.id === activeShotId ? { ...s, scene } : s))
                    );
                  }}
                  className="w-full rounded-lg border border-surface-border bg-surface-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
                />
              </div>

              {/* 分镜图提示词 */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-text-tertiary">分镜图提示词</label>
                <textarea
                  value={storyboardShots.find((s) => s.id === activeShotId)?.imagePrompt || ""}
                  onChange={(e) => {
                    const imagePrompt = e.target.value;
                    setStoryboardShots((prev) =>
                      prev.map((s) => (s.id === activeShotId ? { ...s, imagePrompt } : s))
                    );
                  }}
                  placeholder="输入分镜图提示词..."
                  className="h-32 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => {
                    const shot = storyboardShots.find((s) => s.id === activeShotId);
                    if (shot) generateShotImage(shot);
                  }}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  生成分镜图
                </button>
              </div>

              {/* 视频提示词 */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-text-tertiary">视频提示词</label>
                <textarea
                  value={storyboardShots.find((s) => s.id === activeShotId)?.videoPrompt || ""}
                  onChange={(e) => {
                    const videoPrompt = e.target.value;
                    setStoryboardShots((prev) =>
                      prev.map((s) => (s.id === activeShotId ? { ...s, videoPrompt } : s))
                    );
                  }}
                  placeholder="输入视频提示词..."
                  className="h-32 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => {
                    const shot = storyboardShots.find((s) => s.id === activeShotId);
                    if (shot) generateShotVideo(shot);
                  }}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-1 rounded-lg bg-rose-50 py-2 text-[11px] font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  生成视频
                </button>
              </div>

              {/* 导演台 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-text-tertiary">导演台</label>
                  <button
                    type="button"
                    onClick={() => {
                      const shot = storyboardShots.find((s) => s.id === activeShotId);
                      if (shot) ensureDirectorBlockForShot(shot);
                      setShowDirectorPanel(true);
                    }}
                    className="text-[10px] text-brand hover:text-brand-hover"
                  >
                    {findDirectorBlockForShot(directorBlocks, activeShotId) ? "已启用" : "启用"}
                  </button>
                </div>
                {findDirectorBlockForShot(directorBlocks, activeShotId) && (
                  <div className="rounded-lg bg-surface-card p-2 text-[10px] text-text-secondary">
                    导演台已启用，空间约束已注入生成流程
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const shot = storyboardShots.find((s) => s.id === activeShotId);
                    if (!shot) return;
                    const newShot: StoryboardShot = {
                      ...shot,
                      id: `shot-${Date.now()}`,
                      title: `${shot.title || "镜头"} (复制)`,
                      imageAssetIds: [],
                      videoAssetIds: [],
                    };
                    setStoryboardShots((prev) => [...prev, newShot]);
                  }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-surface-border py-2 text-[11px] text-text-secondary hover:bg-surface-card"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStoryboardShots((prev) => prev.filter((s) => s.id !== activeShotId));
                    setActiveShotId(undefined);
                    setWorkflowView("overview");
                  }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-100 py-2 text-[11px] text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
            </div>
          </div>
        ) : workflowView === "overview" ? (
          <div className="h-full overflow-y-auto p-4">
            <SeedreamWorkflowOverview
              shots={storyboardShots}
              onSelectShot={(shot: StoryboardShot) => {
                setActiveShotId(shot.id);
                setWorkflowView("step");
              }}
              onReorderShots={(shots: StoryboardShot[]) => setStoryboardShots(shots)}
            />
          </div>
        ) : null}
      </ManjuStudioLayout>
    </div>
  );
}