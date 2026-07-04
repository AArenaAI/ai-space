"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen, Copy, Download, FileText, ImageIcon, Layers, Loader2, MessageSquare, PanelLeftOpen, Paperclip, Play, Plus, RefreshCw, Send, Sparkles, Trash2, UploadCloud, Video, Wand2, X, Clapperboard, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useImage, type GeneratedImage } from "@/hooks/useImage";
import { useVideo, type VideoGeneration } from "@/hooks/useVideo";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { consumeChatStream } from "@/lib/chatStream";
import { getErrorMessage, readApiError } from "@/lib/errors";
import { apiFetch } from "@/lib/api/client";

import {
  ASSET_ROLE_OPTIONS,
  CAMERA_MOVES,
  getVideoDurationOptions,
  getVideoResolutionOptions,
  normalizeVideoDurationForModel,
  normalizeVideoResolutionForModel,
  IMAGE_ASPECTS,
  IMAGE_RESOLUTIONS,
  SEEDREAM_IMAGE_QUALITY,
  SEMANTIC_ASSET_KINDS,
  SETTING_BOARD_IMAGES,
  SHOT_PURPOSES,
  SHOT_TYPES,
  VIDEO_ASPECTS,
  VIDEO_MODELS,
  VIDEO_REFERENCE_ROLES,
  DEFAULT_WORKFLOW_MODELS,
  DEFAULT_WORKFLOW_MODEL_STRATEGY,
  WORKFLOW_MODEL_OPTIONS,
  WORKFLOW_MODEL_STRATEGIES,
  WORKFLOW_MODEL_STRATEGY_LABELS,
  WORKFLOW_MODEL_TASKS,
  WORKFLOW_STEPS,
} from "./constants";
import type {
  AssetAssistantMode,
  AssetKind,
  AssetKindFilter,
  AssetRole,
  BatchMode,
  CameraMove,
  GeneratorGroup,
  GenerationJob,
  ScriptAssistantMode,
  ScriptChatMessage,
  ScriptSummary,
  EpisodeOutline,
  EpisodeScript,
  EpisodeScriptScene,
  SeedreamProject,
  SemanticAsset,
  SemanticAssetKind,
  ShotPurpose,
  ShotStatus,
  ShotType,
  StoryFlowStage,
  DirectorBlock,
  StoredAsset,
  StoryboardShot,
  Tab,
  WorkflowMode,
  WorkflowModelConfig,
  WorkflowModelStrategy,
  WorkflowModelTask,
  WorkflowView,
} from "./types";
import { FieldLabel, PillButton } from "./components";
import { useSeedreamProjects } from "./useSeedreamProjects";
import ManjuStudioLayout from "./ManjuStudioLayout";
import FloatingToolbar from "./FloatingToolbar";
import VideoSegmentGenerator from "./VideoSegmentGenerator";
import BatchPreflightPanel from "./BatchPreflightPanel";
import ShotOverviewTable from "./ShotOverviewTable";
import ManjuCanvas, { type CanvasAssetDropPayload, type CanvasConnection, type CanvasNode } from "./ManjuCanvas";
import { copyDirectorBlockToShots, createDefaultDirectorBlock, findDirectorBlockForShot, getSceneAssetForShot, injectDirectorBlockToPrompt } from "./directorBlock";
import {
  ASSET_KIND_LABELS,
  buildGeneratorGroupSummaryPrompt,
  buildSemanticAssetImagePrompt,
  buildStoryboardSketchPrompt,
  buildStructuredShotImagePrompt,
  buildWorkflowSystemPrompt,
  buildScriptOutlineSystemPrompt,
  buildEffectiveIdeaSystemPrompt,
  buildEpisodeScriptSystemPrompt,
} from "./seedreamPrompts";


function extractTextFromChatResponse(data: any): string {
  const choice = data?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || data?.message?.content || data?.content || "";
}

async function fetchWorkflowChat(payload: Record<string, any>): Promise<Response> {
  const initResponse = await apiFetch("/chat/init", {
    method: "POST",
    body: JSON.stringify({ ...payload, stream: true, init_only: true }),
  });
  if (!initResponse.ok) return initResponse;
  const init = await initResponse.json();
  const taskId = Number(init?.task_id || init?.assistant_message?.generation_task_id || 0);
  if (!taskId) {
    return new Response(JSON.stringify(init), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return apiFetch(`/tasks/${taskId}/stream?after=0`);
}

async function fetchWorkflowChatRequest(init: RequestInit): Promise<Response> {
  const rawBody = typeof init.body === "string" ? init.body : "{}";
  const payload = JSON.parse(rawBody || "{}");
  return fetchWorkflowChat(payload);
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

function getSeedreamVideoErrorMessage(message?: string | null) {
  const text = (message || "").trim();
  if (!text) return "后端未返回具体失败原因，请检查视频任务日志或重试。";
  const genericMessages = [
    "视频生成失败，请稍后再试。若多次失败，请换个提示词或素材。",
    "视频生成失败，请稍后重试或调整描述。",
    "视频生成失败，请稍后重试。",
    "视频生成失败",
    "服务暂时不可用",
  ];
  return genericMessages.includes(text) || text.includes("服务暂时不可用")
    ? "后端未返回具体失败原因，请检查视频任务日志或重试。"
    : text;
}

function normalizeVideoDuration(duration?: number, model?: string) {
  return normalizeVideoDurationForModel(model, duration);
}

function normalizeVideoResolution(resolution?: string, model?: string) {
  return normalizeVideoResolutionForModel(model, resolution);
}

type SeedanceVideoReferenceMode = "text_to_video" | "omni_reference" | "image_to_video" | "first_last_frame";

type SeedanceVideoReferencePayload = {
  mode: SeedanceVideoReferenceMode;
  reference_image_urls?: string[];
  reference_image_roles?: Array<"reference_image" | "first_frame" | "last_frame">;
  reference_video_urls?: string[];
  reference_image_role_mode?: "reference" | "first_frame" | "first_last_frame";
  promptInjection?: string;
};

function assetReferenceUrl(asset?: StoredAsset) {
  return asset ? asset.publicId || asset.url || "" : "";
}

function compactRefs(values: Array<string | undefined | null>) {
  return values.map((item) => (item || "").trim()).filter(Boolean);
}

function buildSeedanceVideoReferences(input: {
  mode?: SeedanceVideoReferenceMode;
  images?: string[];
  videos?: string[];
  firstFrame?: string;
  lastFrame?: string;
}): SeedanceVideoReferencePayload {
  const images = compactRefs(input.images || []);
  const videos = compactRefs(input.videos || []);
  const firstFrame = (input.firstFrame || "").trim();
  const lastFrame = (input.lastFrame || "").trim();
  const mode = input.mode || (firstFrame && lastFrame ? "first_last_frame" : images.length || firstFrame ? "image_to_video" : videos.length ? "omni_reference" : "text_to_video");

  if (mode === "text_to_video") return { mode };

  if (mode === "first_last_frame") {
    const frameImages = compactRefs([firstFrame || images[0], lastFrame || images[1]]).slice(0, 2);
    return {
      mode,
      reference_image_urls: frameImages,
      reference_image_roles: frameImages.map((_, index) => index === 0 ? "first_frame" : "last_frame"),
      reference_image_role_mode: frameImages.length >= 2 ? "first_last_frame" : "first_frame",
    };
  }

  if (mode === "image_to_video") {
    const singleImage = compactRefs([firstFrame || images[0]]).slice(0, 1);
    return {
      mode,
      reference_image_urls: singleImage,
      reference_image_roles: singleImage.map(() => "reference_image" as const),
      reference_image_role_mode: "reference",
    };
  }

  // 全能参考模式：所有图片统一为 reference_image。
  // 如果有首帧/尾帧图片，按官方示例把语义注入 prompt 文本（"首帧为图片N，尾帧定格为图片N。"），
  // 而不是用 first_frame/last_frame role 字段。
  const allImages = [...images];
  const promptParts: string[] = [];
  if (firstFrame) {
    let idx = allImages.indexOf(firstFrame);
    if (idx === -1) { allImages.push(firstFrame); idx = allImages.length - 1; }
    promptParts.push(`首帧为图片${idx + 1}`);
  }
  if (lastFrame) {
    let idx = allImages.indexOf(lastFrame);
    if (idx === -1) { allImages.push(lastFrame); idx = allImages.length - 1; }
    promptParts.push(`尾帧定格为图片${idx + 1}`);
  }
  return {
    mode: "omni_reference",
    reference_image_urls: allImages,
    reference_image_roles: allImages.map(() => "reference_image" as const),
    reference_video_urls: videos,
    reference_image_role_mode: "reference",
    promptInjection: promptParts.length ? promptParts.join("，") + "。" : undefined,
  };
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
  return ASSET_KIND_LABELS[kind] || SEMANTIC_ASSET_KINDS.find((item) => item.value === kind)?.label || "资产";
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
    episode: patch.episode,
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
    generationActions: patch.generationActions,
  };
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function parseLooseJson(text: string): any | null {
  const candidates = [stripJsonFence(stripWorkflowText(text))];
  const first = candidates[0];
  if (/\\"(?:episode|title|script|scenes)\\"/.test(first)) {
    candidates.push(first.replace(/\\"/g, '"').replace(/\\n/g, "\n"));
  }
  if ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'"))) {
    candidates.push(first.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n"));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        const nested = parseLooseJson(parsed);
        return nested || parsed;
      }
      return parsed;
    } catch {}
  }
  return null;
}

function extractVisibleEpisodeScript(text: string) {
  const parsed = parseLooseJson(text);
  if (parsed && typeof parsed === "object" && typeof parsed.script === "string") return parsed.script;
  return stripJsonFence(stripWorkflowText(text));
}

function RichMarkdown({ content, inverse = false }: { content: string; inverse?: boolean }) {
  const tone = inverse ? "text-black" : "text-white/76";
  return (
    <div className={cn("max-w-none text-sm leading-6", tone)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-1 text-xl font-semibold leading-7 tracking-[-0.03em]">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold leading-7 tracking-[-0.02em] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold leading-6 first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-inherit">{children}</strong>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          hr: () => <div className={cn("my-4 h-px", inverse ? "bg-black/12" : "bg-white/12")} />,
          code: ({ children }) => <code className={cn("rounded px-1 py-0.5 text-[0.92em]", inverse ? "bg-black/8" : "bg-white/10")}>{children}</code>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const DEFAULT_SCRIPT_SUMMARY: ScriptSummary = {
  episodeCount: 5,
  genre: "",
  targetAudience: "大众",
  coreHook: "",
  logline: "",
  charactersText: "",
  synopsis: "",
};

function formatOutlineSourceFromSummary(summary: ScriptSummary) {
  return [
    summary.genre ? `【类型】\n${summary.genre}` : "",
    summary.targetAudience ? `【目标受众】\n${summary.targetAudience}` : "",
    summary.coreHook ? `【核心梗】\n${summary.coreHook}` : "",
    summary.logline ? `【一句话故事】\n${summary.logline}` : "",
    summary.charactersText ? `【人物关系】\n${summary.charactersText}` : "",
    summary.synopsis ? `【故事梗概】\n${summary.synopsis}` : "",
  ].filter(Boolean).join("\n\n").trim();
}

function parseEffectiveIdeaResult(raw: string) {
  const cleaned = stripJsonFence(stripWorkflowText(raw));
  const parsed = parseLooseJson(cleaned);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as any).outlineSource === "string") {
    return String((parsed as any).outlineSource || "").trim();
  }
  return cleaned.trim();
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

function parseScriptOutlineResult(raw: string): { summary: ScriptSummary; episodes: EpisodeOutline[] } {
  const cleaned = stripJsonFence(stripWorkflowText(raw));
  try {
    const parsed = JSON.parse(cleaned);
    const summary = parsed?.summary || {};
    const episodes = Array.isArray(parsed?.episodes) ? parsed.episodes : [];
    return {
      summary: {
        ...DEFAULT_SCRIPT_SUMMARY,
        episodeCount: Number(summary.episodeCount || summary.episode_count || episodes.length || 5),
        genre: String(summary.genre || ""),
        targetAudience: String(summary.targetAudience || summary.target_audience || "大众"),
        coreHook: String(summary.coreHook || summary.core_hook || ""),
        logline: String(summary.logline || ""),
        charactersText: String(summary.charactersText || summary.characters_text || summary.characters || ""),
        synopsis: String(summary.synopsis || ""),
      },
      episodes: episodes.map((item: any, index: number) => ({
        episode: Number(item.episode || index + 1),
        title: String(item.title || `第${index + 1}集`),
        summary: String(item.summary || item.description || ""),
      })).filter((item: EpisodeOutline) => item.summary.trim()),
    };
  } catch {
    return { summary: { ...DEFAULT_SCRIPT_SUMMARY, synopsis: cleaned }, episodes: [] };
  }
}

function normalizeEpisodeScenes(value: any): EpisodeScriptScene[] {
  if (!Array.isArray(value)) return [];
  return value.map((scene, index) => ({
    scene: Number(scene?.scene || scene?.index || index + 1),
    title: scene?.title ? String(scene.title) : undefined,
    location: String(scene?.location || scene?.place || ""),
    time: String(scene?.time || scene?.timeOfDay || ""),
    characters: Array.isArray(scene?.characters) ? scene.characters.map((item: any) => String(item)).filter(Boolean) : [],
    visualAction: String(scene?.visual_action || scene?.visualAction || scene?.action || ""),
    dialogue: Array.isArray(scene?.dialogue) ? scene.dialogue.map((line: any) => ({
      character: String(line?.character || line?.speaker || ""),
      text: String(line?.text || line?.line || ""),
      tone: line?.tone ? String(line.tone) : undefined,
    })).filter((line: { text: string }) => line.text.trim()) : [],
    narration: scene?.narration ? String(scene.narration) : undefined,
    emotion: scene?.emotion ? String(scene.emotion) : undefined,
    hook: scene?.hook ? String(scene.hook) : undefined,
  })).filter((scene) => scene.location || scene.visualAction || scene.dialogue.length || scene.narration || scene.hook);
}

function formatEpisodeScriptFromScenes(episode: number, title: string, scenes: EpisodeScriptScene[]) {
  if (!scenes.length) return "";
  const blocks = scenes.map((scene) => {
    const people = scene.characters.length ? scene.characters.join("、") : "未标注人物";
    const dialogue = scene.dialogue.length
      ? scene.dialogue.map((line) => `${line.character || "角色"}${line.tone ? `（${line.tone}）` : ""}：${line.text}`).join("\n")
      : "无";
    return [
      `场${scene.scene}｜${scene.location || "未标注地点"}｜${scene.time || "未标注时间"}｜${people}`,
      scene.title ? `【场景标题】\n${scene.title}` : "",
      scene.visualAction ? `【画面动作】\n${scene.visualAction}` : "",
      `【对白】\n${dialogue}`,
      scene.narration ? `【旁白】\n${scene.narration}` : "",
      scene.emotion ? `【情绪推进】\n${scene.emotion}` : "",
      scene.hook ? `【悬念钩子】\n${scene.hook}` : "",
    ].filter(Boolean).join("\n");
  });
  return [`第${episode}集：${title}`, ...blocks].join("\n\n");
}

function parseEpisodeScriptResult(raw: string, outline: EpisodeOutline): EpisodeScript {
  const cleaned = stripJsonFence(stripWorkflowText(raw));
  const parsed = parseLooseJson(cleaned);
  if (parsed && typeof parsed === "object") {
    const episode = Number(parsed?.episode || outline.episode);
    const title = String(parsed?.title || outline.title);
    const scenes = normalizeEpisodeScenes(parsed?.scenes);
    const script = extractVisibleEpisodeScript(String(parsed?.script || formatEpisodeScriptFromScenes(episode, title, scenes) || cleaned));
    return { episode, title, script, scenes, status: "done" };
  }
  return { episode: outline.episode, title: outline.title, script: extractVisibleEpisodeScript(cleaned), scenes: [], status: "done" };
}

function cleanShotBody(chunk: string) {
  return chunk
    .replace(/^#{2,4}\s*段\s*\d+[^\n]*\n?/i, "")
    .replace(/^\*\*场景：\*\*.*$/gm, "")
    .replace(/^\*\*视角：\*\*.*$/gm, "")
    .replace(/^---$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function inferShotTypeFromText(text: string): ShotType {
  if (/空镜|固定画面|走廊深处/.test(text)) return "空镜";
  if (/特写|手机屏幕|屏幕特写|下半张脸/.test(text)) return "特写";
  if (/全景|所有人|空间|门厅空间/.test(text)) return "全景";
  if (/走近|快步|拉门|动作|穿过/.test(text)) return "动作镜头";
  return "中景";
}

function inferCameraMoveFromText(text: string): CameraMove {
  if (/上摇|摇到|环视/.test(text)) return "摇";
  if (/走近|跟上|跟/.test(text)) return "跟";
  if (/手持|手机画面|微晃|POV/.test(text)) return "手持";
  if (/扫过|光束|从左到右|下落/.test(text)) return "移";
  if (/推近/.test(text)) return "推";
  return "固定";
}

function inferShotPurposeFromText(text: string): ShotPurpose {
  if (/钩子|黑屏|没有信号|弹幕|敲窗/.test(text)) return "悬念钩子";
  if (/规则|不是人|信息|确认|电话/.test(text)) return "信息揭示";
  if (/进入|走向|闭合|拉门|衔接/.test(text)) return "动作衔接";
  if (/环境|空间|门厅|教学楼/.test(text)) return "交代环境";
  return "信息揭示";
}

function normalizeSentence(value: string) {
  return value.replace(/[。\.\s]+$/g, "");
}

function extractCharactersFromShotText(text: string) {
  const names = ["寸头男", "王彦", "小陈", "长发女人", "大东", "五个人", "玩家", "博主"];
  const found = names.filter((name) => text.includes(name));
  if (/深色人影|窗户后站着|贴紧玻璃|看不清它的五官|看不清衣服/.test(text)) found.push("窗后的深色人影");
  if (/楼梯口.*站着一个人|走廊深处.*站着一个人/.test(text)) found.push("黑暗中的人影");
  return Array.from(new Set(found));
}

function buildModelAgnosticAction(action: string, actionInput: string, supplementary: Record<string, unknown>) {
  return { action, actionInput: actionInput.trim(), supplementary };
}

function buildShotImagePromptFromScript(shot: StoryboardShot, chunk: string) {
  const body = cleanShotBody(chunk).split("\n").slice(0, 8).join(" ");
  return [
    "静态分镜画面，竖屏9:16。",
    `镜头${shot.index}《${shot.title}》。`,
    shot.scene ? `场景：${normalizeSentence(shot.scene)}。` : "",
    shot.characters.length ? `画面人物/实体：${shot.characters.join("、")}。` : "画面人物/实体：无明确角色，只保留环境主体。",
    `景别：${shot.shotType}。`,
    `画面重点：${body}`,
    "恐怖悬疑漫剧质感，低照度，真实空间关系，电影感构图；不要字幕水印，不要血腥，不要角色变脸。",
  ].filter(Boolean).join("\n");
}

function buildShotVideoPromptFromScript(shot: StoryboardShot, chunk: string) {
  const body = cleanShotBody(chunk).split("\n").slice(0, 12).join(" ");
  return [
    `视频镜头${shot.index}《${shot.title}》，${shot.duration}秒，${shot.aspectRatio}。`,
    shot.scene ? `场景：${normalizeSentence(shot.scene)}。` : "",
    shot.characters.length ? `出场人物/实体：${shot.characters.join("、")}。` : "出场人物/实体：无明确角色，只保留环境主体。",
    `视角/运镜：${shot.cameraMove}，${shot.shotType}。`,
    `动作与节奏：${body}`,
    shot.dialogue ? `对白：${shot.dialogue}` : "",
    shot.narration ? `旁白/字幕：${shot.narration}` : "",
    "保持角色和场景一致，动作连续，恐怖悬疑氛围；不要字幕水印，不要血腥。",
  ].filter(Boolean).join("\n");
}

function parseStoryboardShots(text: string, model?: string): StoryboardShot[] {
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
        imagePrompt: item.imagePrompt || item.image_prompt || item.seedream_prompt || item.storyboard_image?.action_input || item.generation_actions?.storyboard_image?.action_input || item.generationActions?.storyboardImage?.actionInput || "",
        videoPrompt: item.videoPrompt || item.video_prompt || item.seedance_prompt || item.shot_video?.action_input || item.generation_actions?.shot_video?.action_input || item.generationActions?.shotVideo?.actionInput || "",
        shotType: isShotType(String(item.shotType || item.shot_type || item.shot_size || "")) ? String(item.shotType || item.shot_type || item.shot_size) as ShotType : "中景",
        cameraMove: isCameraMove(String(item.cameraMove || item.camera_move || item.camera || "")) ? String(item.cameraMove || item.camera_move || item.camera) as CameraMove : "固定",
        purpose: isShotPurpose(String(item.purpose || item.shot_purpose || "")) ? String(item.purpose || item.shot_purpose) as ShotPurpose : "信息揭示",
        duration: normalizeVideoDuration(Number(item.duration || item.duration_seconds || 5), model),
        aspectRatio: item.aspectRatio || item.aspect_ratio || "9:16",
        generationActions: item.generationActions || item.generation_actions
          ? {
            storyboardImage: item.generationActions?.storyboardImage || item.generation_actions?.storyboard_image
              ? buildModelAgnosticAction(
                item.generationActions?.storyboardImage?.action || item.generation_actions?.storyboard_image?.action || "image.generate",
                item.generationActions?.storyboardImage?.actionInput || item.generation_actions?.storyboard_image?.action_input || item.image_prompt || "",
                item.generationActions?.storyboardImage?.supplementary || item.generation_actions?.storyboard_image?.supplementary || {}
              )
              : undefined,
            shotVideo: item.generationActions?.shotVideo || item.generation_actions?.shot_video
              ? buildModelAgnosticAction(
                item.generationActions?.shotVideo?.action || item.generation_actions?.shot_video?.action || "video.generate",
                item.generationActions?.shotVideo?.actionInput || item.generation_actions?.shot_video?.action_input || item.video_prompt || "",
                item.generationActions?.shotVideo?.supplementary || item.generation_actions?.shot_video?.supplementary || {}
              )
              : undefined,
          }
          : undefined,
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
    const titleMatch = firstLine.match(/^段\s*(\d+)\s*(.+?)(?:\s*\/\s*\d+秒)?$/);
    const normalizedTitle = titleMatch ? `段${titleMatch[1].padStart(2, "0")} ${titleMatch[2].trim()}` : firstLine;
    const explicitVideoPrompt = chunk.match(/(?:\*\*Seedance提示词：\*\*|Seedance提示词[:：]|直接投喂提示词[:：]|视频提示词[:：]|video_prompt[:：])\s*([\s\S]*?)(?=\n\s*(?:\*\*[^*]+：\*\*|#{2,4}\s*段|#{2,4}\s*(?:镜头|分镜)|---|$))/i)?.[1]?.trim();
    const explicitImagePrompt = chunk.match(/(?:image_prompt|图片提示词|分镜图提示词|Seedream提示词)[:：]\s*([\s\S]*?)(?=\n\s*(?:video_prompt|视频提示词|Seedance提示词|直接投喂提示词|#{2,4}\s*段|#{2,4}\s*(?:镜头|分镜)|---|$))/i)?.[1]?.trim() || "";
    const scene = chunk.match(/(?:\*\*场景：\*\*)\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:场景|地点|素材绑定)[:：]\s*(.+)/)?.[1]?.replace(/^\*+\s*/, "").trim()
      || chunk.match(/(?:\*\*空间锚点：\*\*)\s*(.+)/)?.[1]?.trim()
      || chunk.match(/(?:空间锚点)[:：]\s*(.+)/)?.[1]?.trim()
      || "";
    const durationMatch = chunk.match(/\/\s*(\d+)\s*秒/) || chunk.match(/[（(]?(\d+)\s*秒[）)]?/) || chunk.match(/(?:时长|duration)[:：]\s*(\d+)/i);
    const seedanceMarked = extractSeedanceMarkedText(chunk);
    const parsedShotType = chunk.match(/(?:景别|镜头类型)[:：]\s*(.+)/)?.[1]?.trim() || "";
    const parsedCameraMove = chunk.match(/(?:运镜|镜头运动)[:：]\s*(.+)/)?.[1]?.trim() || "";
    const shot = createShot(idx + 1, {
      title: normalizedTitle.slice(0, 60),
      scene,
      characters: extractCharactersFromShotText(chunk),
      dialogue: seedanceMarked.dialogue,
      narration: seedanceMarked.narration,
      shotType: isShotType(parsedShotType) ? parsedShotType as ShotType : inferShotTypeFromText(chunk),
      cameraMove: isCameraMove(parsedCameraMove) ? parsedCameraMove as CameraMove : inferCameraMoveFromText(chunk),
      purpose: inferShotPurposeFromText(chunk),
      duration: normalizeVideoDuration(durationMatch ? Number(durationMatch[1]) : 5, model),
      aspectRatio: "9:16",
    });
    const imagePrompt = explicitImagePrompt || buildShotImagePromptFromScript(shot, chunk);
    const videoPrompt = explicitVideoPrompt || buildShotVideoPromptFromScript({ ...shot, imagePrompt }, chunk);
    return {
      ...shot,
      imagePrompt,
      videoPrompt,
      generationActions: {
        storyboardImage: buildModelAgnosticAction("image.generate", imagePrompt, {
          role: "storyboard_image",
          aspect_ratio: shot.aspectRatio,
          resolution: "2K",
          style: ["恐怖悬疑", "漫剧分镜", "低照度电影感"],
          negative_prompt: "字幕、水印、血腥、肢体畸形、角色变脸",
        }),
        shotVideo: buildModelAgnosticAction("video.generate", videoPrompt, {
          role: "shot_video",
          duration: shot.duration,
          aspect_ratio: shot.aspectRatio,
          resolution: "720p",
          audio: false,
          input_image: "storyboard_image",
        }),
      },
    };
  });
}

function parseSemanticAssets(text: string): SemanticAsset[] {
  const cleaned = stripJsonFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : parsed?.assets || parsed?.semanticAssets;
    if (Array.isArray(list)) {
      return list.map((item: any) => {
        const kind = (item.kind || item.type || "character") as SemanticAssetKind;
        const name = item.name || item.title || "未命名资产";
        const summary = item.summary || item.description || `${ASSET_KIND_LABELS[kind] || "资产"}：${name}。根据剧情材料提取，需在录入资产库前补充外观/空间/用途/剧情功能。`;
        const lockPrompt = item.lockPrompt || item.lock_prompt || item.image_prompt || item.prompt || `${name}，${summary}，可作为 Seedream 资产参考图的一致性锁定词，清晰主体，稳定特征，干净构图`;
        return {
          id: item.id || `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          name,
          summary,
          lockPrompt,
          negativePrompt: item.negativePrompt || item.negative_prompt || "避免文字水印、错乱结构、重复肢体、低清晰度、风格不一致",
          linkedAssetIds: Array.isArray(item.linkedAssetIds) ? item.linkedAssetIds : [],
          createdAt: item.createdAt || new Date().toISOString(),
        };
      }).filter((item: SemanticAsset) => ["character", "scene", "prop", "style"].includes(item.kind));
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

function normalizeSemanticAssetKey(asset: Pick<SemanticAsset, "kind" | "name">) {
  return `${asset.kind}::${asset.name.trim().replace(/\s+/g, "").toLowerCase()}`;
}

function chooseCanonicalSemanticAsset(group: SemanticAsset[]) {
  return [...group].sort((a, b) => {
    const score = (asset: SemanticAsset) =>
      (asset.imageUrl || asset.imageAssetId ? 1000 : 0)
      + ((asset.linkedAssetIds?.length || 0) * 20)
      + (asset.summary?.trim().length || 0)
      + (asset.lockPrompt?.trim().length || 0);
    return score(b) - score(a);
  })[0];
}

function mergeDuplicateSemanticAssets(assets: SemanticAsset[]) {
  const groups = new Map<string, SemanticAsset[]>();
  assets.forEach((asset) => {
    const key = normalizeSemanticAssetKey(asset);
    groups.set(key, [...(groups.get(key) || []), asset]);
  });

  const idMap = new Map<string, string>();
  const merged: SemanticAsset[] = [];
  let removedCount = 0;

  groups.forEach((group) => {
    if (group.length === 1) {
      merged.push(group[0]);
      idMap.set(group[0].id, group[0].id);
      return;
    }

    removedCount += group.length - 1;
    const canonical = chooseCanonicalSemanticAsset(group);
    const newestText = group[0];
    group.forEach((asset) => idMap.set(asset.id, canonical.id));
    merged.push({
      ...canonical,
      kind: newestText.kind,
      name: newestText.name,
      summary: newestText.summary || canonical.summary,
      lockPrompt: newestText.lockPrompt || canonical.lockPrompt,
      negativePrompt: newestText.negativePrompt || canonical.negativePrompt,
      linkedAssetIds: Array.from(new Set(group.flatMap((asset) => asset.linkedAssetIds || []))),
      imageAssetId: canonical.imageAssetId || group.find((asset) => asset.imageAssetId)?.imageAssetId,
      imageUrl: canonical.imageUrl || group.find((asset) => asset.imageUrl)?.imageUrl,
      createdAt: canonical.createdAt || newestText.createdAt,
    });
  });

  return { assets: merged, idMap, removedCount };
}

function remapSemanticAssetIds(ids: string[] | undefined, idMap: Map<string, string>) {
  return Array.from(new Set((ids || []).map((id) => idMap.get(id) || id).filter(Boolean)));
}

const TAB_VALUES: Tab[] = ["workflow", "image", "video"];
const WORKFLOW_MODE_VALUES: WorkflowMode[] = ["script", "assets", "storyboardVideo", "storyboardImage"];

const DEFAULT_ASSET_EXTRACT_INSTRUCTION = [
  "从剧本大纲、分集正文和当前镜头列表中提取后续制作必须进入资产库的候选资产，不生成图片。",
  "人物资产优先读取【剧本大纲/人物小传】，因为这里包含定妆、性格、关系和成长弧线；不要只按第一集正文里短暂出场信息生成角色。",
  "场景、关键道具和本集临时视觉元素优先读取【分集正文/当前镜头列表】；整体风格综合大纲类型、故事梗概和本集画面。",
  "必须覆盖四类：角色、场景、关键道具、整体风格；不要把普通一次性动作当资产。",
  "每个资产必须填满 summary、lock_prompt、negative_prompt，禁止留空，内容用中文输出。",
  "人物资产的 summary 只能写【人物外貌定妆】，不是人物介绍/人物小传；只保留年龄段、体型、脸部气质、发型、服装、随身物、标志性动作/姿态、可视化伤痕或器物痕迹。",
  "人物资产禁止写团队职责、人物关系、性格弧线、通关结局、剧情作用、规则解释、内心动机、能力强弱等不可直接画出来的信息。",
  "场景 summary 写空间结构/陈设/光线/材质/年代感；道具 summary 写形制/材质/磨损/符号/用途可视细节；风格 summary 写画面质感/色彩/镜头语言。",
  "lock_prompt 写给 Seedream 生图：同样只写可视化信息，用中文写稳定外观、服装、材质、光线、时代、风格和关键可视特征；除 Seedream 等模型名外不要输出英文句子。",
  "输出严格 JSON：{ \"assets\": [{ \"kind\": \"character|scene|prop|style\", \"name\": \"\", \"summary\": \"\", \"lock_prompt\": \"\", \"negative_prompt\": \"\" }] }。",
].join("\n");

type AssetCandidate = SemanticAsset & { selected: boolean };

function canvasNodesSignature(nodes: CanvasNode[]) {
  return nodes
    .map((node) => {
      const data = (node.data || {}) as Record<string, unknown>;
      const dataSig = [
        data.sourceShotId,
        data.imagePrompt,
        data.videoPrompt,
        data.scene,
        data.content,
        data.thumbnail,
        data.url,
      ].map((value) => String(value || "").slice(0, 120)).join("~");
      return `${node.id}:${node.type}:${node.title}:${node.x}:${node.y}:${node.status || ""}:${dataSig}`;
    })
    .join("|");
}

function canvasConnectionsSignature(connections: CanvasConnection[]) {
  return connections
    .map((conn) => `${conn.id}:${conn.from}:${conn.to}:${conn.type || ""}:${conn.label || ""}`)
    .join("|");
}

function storyboardGridPosition(index: number) {
  const columns = 4;
  const cardWidth = 360;
  const cardHeight = 420;
  const gapX = 140;
  const gapY = 170;
  const startX = 560;
  const startY = 520;
  return {
    x: startX + (index % columns) * (cardWidth + gapX),
    y: startY + Math.floor(index / columns) * (cardHeight + gapY),
  };
}

function storyboardVideoPosition(index: number) {
  const base = storyboardGridPosition(index);
  return { x: base.x + 500, y: base.y };
}

function assetShelfPosition(index: number) {
  const columns = 4;
  const cardWidth = 360;
  const cardHeight = 440;
  const gapX = 120;
  const gapY = 120;
  const startX = 560;
  const startY = 40;
  return {
    x: startX + (index % columns) * (cardWidth + gapX),
    y: startY + Math.floor(index / columns) * (cardHeight + gapY),
  };
}

function layoutStudioNodes(nodes: CanvasNode[]) {
  const shotNodes = nodes
    .filter((node) => node.type === "shot")
    .sort((a, b) => {
      const ai = Number(String(a.title).match(/^\s*(\d+)/)?.[1] || 9999);
      const bi = Number(String(b.title).match(/^\s*(\d+)/)?.[1] || 9999);
      return ai - bi;
    });
  const assetNodes = nodes.filter((node) => node.type === "assets");
  const shotPositions = new Map(shotNodes.map((node, index) => [node.id, storyboardGridPosition(index)]));
  const videoPositions = new Map(shotNodes.map((node, index) => [`video-node-${node.id}`, storyboardVideoPosition(index)]));
  const assetPositions = new Map(assetNodes.map((node, index) => [node.id, assetShelfPosition(index)]));
  const bottomY = storyboardGridPosition(Math.max(shotNodes.length, 1)).y + 120;

  return nodes.map((node, index) => {
    if (node.id === "script-main") return { ...node, x: 60, y: 120 };
    if (assetPositions.has(node.id)) return { ...node, ...assetPositions.get(node.id)! };
    if (shotPositions.has(node.id)) return { ...node, ...shotPositions.get(node.id)! };
    if (videoPositions.has(node.id)) return { ...node, ...videoPositions.get(node.id)! };
    if (node.type === "director") return { ...node, x: 60, y: bottomY };
    if (node.type === "generator") return { ...node, x: 560 + (index % 3) * 480, y: bottomY + Math.floor(index / 3) * 380 };
    return node;
  });
}

function hasCongestedShotLayout(nodes: CanvasNode[]) {
  const shotNodes = nodes.filter((node) => node.type === "shot");
  if (shotNodes.length < 2) return false;
  for (let i = 0; i < shotNodes.length; i++) {
    for (let j = i + 1; j < shotNodes.length; j++) {
      const a = shotNodes[i];
      const b = shotNodes[j];
      const xOverlap = Math.abs(a.x - b.x) < 390;
      const yOverlap = Math.abs(a.y - b.y) < 450;
      if (xOverlap && yOverlap) return true;
    }
  }
  return false;
}

export default function SeedreamBetaPage() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { images, generateImage, isGenerating, fetchImages } = useImage("seedream");
  const { videos, generateVideo, generating: videoGenerating } = useVideo();

  const { setProjects, activeProject, createProject } = useSeedreamProjects(t("seedreamBeta.projects.newProject"));
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("workflow");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("2K");
  const [assetPreset, setAssetPreset] = useState<"character" | "characterTurnaround" | "asset">("character");
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
  const tabParam = searchParams?.get("tab");
  const modeParam = searchParams?.get("mode");

  useEffect(() => {
    if (tabParam && TAB_VALUES.includes(tabParam as Tab)) {
      setTab((current) => (current === tabParam ? current : (tabParam as Tab)));
    }
    if (modeParam && WORKFLOW_MODE_VALUES.includes(modeParam as WorkflowMode)) {
      setTab((current) => (current === "workflow" ? current : "workflow"));
      setWorkflowMode((current) => (current === modeParam ? current : (modeParam as WorkflowMode)));
      setWorkflowView((current) => (current === "step" ? current : "step"));
    } else if (tabParam === "workflow" && !modeParam) {
      setWorkflowView((current) => (current === "overview" ? current : "overview"));
    }
  }, [modeParam, tabParam]);

  const [workflowIdea, setWorkflowIdea] = useState("");
  const [flowStage, setFlowStage] = useState<StoryFlowStage>("idea");
  const [modelStrategy, setModelStrategy] = useState<WorkflowModelStrategy>(DEFAULT_WORKFLOW_MODEL_STRATEGY);
  const [workflowModels, setWorkflowModels] = useState<WorkflowModelConfig>(DEFAULT_WORKFLOW_MODELS);
  const [showModelAdvanced, setShowModelAdvanced] = useState(false);
  const [originalIdea, setOriginalIdea] = useState("");
  const [outlineSource, setOutlineSource] = useState("");
  const [ideaSourceReference, setIdeaSourceReference] = useState("");
  const [ideaInput, setIdeaInput] = useState("");
  const [ideaChatMessages, setIdeaChatMessages] = useState<ScriptChatMessage[]>([]);
  const [ideaChatting, setIdeaChatting] = useState(false);
  const [scriptSummary, setScriptSummary] = useState<ScriptSummary>(DEFAULT_SCRIPT_SUMMARY);
  const [episodeOutlines, setEpisodeOutlines] = useState<EpisodeOutline[]>([]);
  const [episodeScripts, setEpisodeScripts] = useState<EpisodeScript[]>([]);
  const [activeEpisode, setActiveEpisode] = useState(1);
  const [ideaExtracting, setIdeaExtracting] = useState(false);
  const [outlineGenerating, setOutlineGenerating] = useState(false);
  const [episodeScriptGenerating, setEpisodeScriptGenerating] = useState<number | "all" | null>(null);
  const [workflowNovel, setWorkflowNovel] = useState("");
  const [scriptSourceExcerpt, setScriptSourceExcerpt] = useState("");
  const [scriptAdaptationInstruction, setScriptAdaptationInstruction] = useState("");
  const [workflowScript, setWorkflowScript] = useState("");
  const [workflowAssets, setWorkflowAssets] = useState("");
  const [assetExtractInstruction, setAssetExtractInstruction] = useState(DEFAULT_ASSET_EXTRACT_INSTRUCTION);
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
  const cleanedAssetProjectIdsRef = useRef<Set<string>>(new Set());
  const [assetCandidates, setAssetCandidates] = useState<AssetCandidate[]>([]);
  const [assetPreprocessOpen, setAssetPreprocessOpen] = useState(false);
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

  // ===== Studio 画布状态 =====
  const [studioNodes, setStudioNodes] = useState<CanvasNode[]>([]);
  const [studioConnections, setStudioConnections] = useState<CanvasConnection[]>([]);
  const [studioSelectedNodeId, setStudioSelectedNodeId] = useState<string | null>(null);
  const [generatorGroups, setGeneratorGroups] = useState<GeneratorGroup[]>([]);
  const [videoNodeStates, setVideoNodeStates] = useState<Record<string, { status: CanvasNode["status"]; errorMessage?: string }>>({});

  const storedAssetUrlById = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((asset) => {
      if (asset.url) map.set(asset.id, asset.url);
      if (asset.publicId) map.set(asset.publicId, asset.url || asset.publicId);
    });
    return map;
  }, [assets]);

  const activeEpisodeShots = useMemo(
    () => storyboardShots.filter((shot) => Number(shot.episode || activeEpisode) === activeEpisode),
    [storyboardShots, activeEpisode],
  );

  const storyboardFormalImageReadyCount = useMemo(
    () => storyboardShots.filter((shot) => assets.some((asset) => shot.imageAssetIds.includes(asset.id) && asset.type === "image" && !isStoryboardSketchAsset(asset))).length,
    [assets, storyboardShots],
  );
  const storyboardVideoReadyCount = useMemo(
    () => storyboardShots.filter((shot) => (shot.videoAssetIds || []).length > 0 || shot.status === "video_ready").length,
    [storyboardShots],
  );

  const setWorkflowModelStrategy = (strategy: WorkflowModelStrategy) => {
    setModelStrategy(strategy);
    if (strategy !== "custom") {
      setWorkflowModels(WORKFLOW_MODEL_STRATEGIES[strategy]);
    }
  };

  const updateWorkflowModel = (task: WorkflowModelTask, model: string) => {
    setModelStrategy("custom");
    setWorkflowModels((prev) => ({ ...prev, [task]: model }));
  };

  const getWorkflowModel = (task: WorkflowModelTask) => workflowModels[task] || DEFAULT_WORKFLOW_MODELS[task];

  // 从项目数据同步画布节点（保留已有位置）
  useEffect(() => {
    setStudioNodes((currentNodes) => {
      const positionMap = new Map(currentNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      const nodes: CanvasNode[] = [];

    // 不再为空项目补默认节点；画布只显示真实项目数据或用户手动新增节点。
    if (workflowScript?.trim()) {
      const pos = positionMap.get("script-main");
      nodes.push({
        id: "script-main",
        type: "script",
        title: "剧本",
        x: pos?.x ?? 60,
        y: pos?.y ?? 120,
        width: 420,
        height: 300,
        data: { content: workflowScript },
        status: "done",
      });
    }

    // 资产库不自动派生成画布节点；只有用户从资产库主动插入/拖入时，才保留对应的 studio-assets-* 画布节点。

    // 镜头卡是结构数据，不再作为画布主元素自动铺开；画布只放可生产/可引用的产物节点。
    activeEpisodeShots.forEach((shot, i) => {
      const hasImage = shot.imageAssetIds && shot.imageAssetIds.length > 0;
      const hasVideo = shot.videoAssetIds && shot.videoAssetIds.length > 0;
      const videoNodeState = videoNodeStates[shot.id];
      const hasActiveImageNode = hasImage || shot.status === "image_generating";
      const hasActiveVideoNode = hasVideo || videoNodeState?.status === "generating" || videoNodeState?.status === "error";
      const firstImageAssetId = shot.imageAssetIds?.[0];
      const firstVideoAssetId = shot.videoAssetIds?.[0];
      const resolvedShotImageUrl = firstImageAssetId ? storedAssetUrlById.get(firstImageAssetId) : undefined;
      const resolvedFirstFrameUrl = shot.firstFrameAssetId ? storedAssetUrlById.get(shot.firstFrameAssetId) : undefined;
      const resolvedShotVideoUrl = firstVideoAssetId ? storedAssetUrlById.get(firstVideoAssetId) : undefined;

      if (hasActiveImageNode) {
        const imageNodeId = `image-node-${shot.id}`;
        const imagePos = positionMap.get(imageNodeId);
        nodes.push({
          id: imageNodeId,
          type: "image",
          title: `${i + 1}. 分镜图`,
          x: imagePos?.x ?? storyboardGridPosition(i).x,
          y: imagePos?.y ?? storyboardGridPosition(i).y,
          width: 360,
          height: 420,
          data: { ...shot, sourceShotId: shot.id, imageUrl: resolvedShotImageUrl, imageAssetId: firstImageAssetId, errorMessage: shot.status === "failed" ? "分镜图生成失败，请检查任务日志或重试。" : undefined },
          status: shot.status === "image_generating" ? "generating" : hasImage ? "done" : shot.status === "failed" ? "error" : "empty",
        });
      }

      if (hasActiveVideoNode) {
        const videoNodeId = `video-node-${shot.id}`;
        const videoPos = positionMap.get(videoNodeId);
        nodes.push({
          id: videoNodeId,
          type: "video",
          title: `${i + 1}. 视频片段`,
          x: videoPos?.x ?? storyboardVideoPosition(i).x,
          y: videoPos?.y ?? storyboardVideoPosition(i).y,
          width: 360,
          height: 420,
          data: { ...shot, sourceShotId: shot.id, firstFrameUrl: resolvedFirstFrameUrl, videoUrl: resolvedShotVideoUrl, errorMessage: videoNodeState?.status === "error" ? getSeedreamVideoErrorMessage(videoNodeState?.errorMessage) : undefined },
          status: videoNodeState?.status === "error" ? "error" : videoNodeState?.status === "generating" ? "generating" : hasVideo ? "done" : "empty",
        });
      }
    });

    // 导演台节点只在已有导演台数据时显示，不再为空项目补默认入口。
    if (directorBlocks.length > 0) {
      const pos = positionMap.get("director-main");
      nodes.push({
        id: "director-main",
        type: "director",
        title: "导演台",
        x: pos?.x ?? 60,
        y: pos?.y ?? storyboardGridPosition(Math.max(activeEpisodeShots.length, 1)).y + 120,
        width: 420,
        height: 280,
        data: { shotCount: activeEpisodeShots.length, episode: activeEpisode },
        status: "done",
      });
    }

    generatorGroups.forEach((group, i) => {
      const pos = positionMap.get(group.id);
      nodes.push({
        id: group.id,
        type: "generator",
        title: group.title,
        x: pos?.x ?? 560 + (i % 3) * 480,
        y: pos?.y ?? storyboardGridPosition(Math.max(activeEpisodeShots.length, 1)).y + 120 + Math.floor(i / 3) * 380,
        width: 420,
        height: 300,
        data: {
          mode: group.mode,
          shotIds: group.shotIds,
          promptPreview: group.promptPreview,
          scene: group.mode === "image" ? "批量分镜图生成器" : "批量视频生成器",
        },
        status: group.shotIds.length ? "draft" : "empty",
      });
    });

      const generatedIds = new Set(nodes.map((node) => node.id));
      const autoVideoSourceIds = new Set(
        nodes
          .filter((node) => node.type === "video" && node.id.startsWith("video-node-"))
          .map((node) => typeof node.data?.sourceShotId === "string" ? node.data.sourceShotId : node.id.replace("video-node-", ""))
      );
      const manualStudioNodes = currentNodes
        .filter((node) => {
          if (!node.id.startsWith("studio-") || generatedIds.has(node.id)) return false;
          const sourceShotId = typeof node.data?.sourceShotId === "string" ? node.data.sourceShotId : undefined;
          return !(node.type === "video" && sourceShotId && autoVideoSourceIds.has(sourceShotId));
        })
        .map((node) => {
          if (node.type === "assets") {
            const linkedAssetId = typeof node.data?.linkedAssetId === "string" ? node.data.linkedAssetId : node.id;
            const linkedAsset = semanticAssets.find((asset) => asset.id === linkedAssetId);
            if (!linkedAsset) return node;
            const assetJob = generationJobs.find((job) => job.type === "image" && job.semanticAssetId === linkedAssetId && (job.status === "pending" || job.status === "failed"));
            const nextStatus: CanvasNode["status"] = assetJob?.status === "pending"
              ? "generating"
              : assetJob?.status === "failed"
                ? "error"
                : linkedAsset.imageUrl || linkedAsset.imageAssetId
                  ? "done"
                  : node.status === "generating" ? "draft" : node.status;
            return {
              ...node,
              title: linkedAsset.name || node.title,
              status: nextStatus,
              data: {
                ...node.data,
                linkedAssetId,
                kind: linkedAsset.kind,
                category: linkedAsset.kind,
                summary: linkedAsset.summary || node.data?.summary,
                content: linkedAsset.summary || node.data?.content,
                lockPrompt: linkedAsset.lockPrompt || node.data?.lockPrompt,
                imageAssetId: linkedAsset.imageAssetId || node.data?.imageAssetId,
                imageUrl: linkedAsset.imageUrl || node.data?.imageUrl,
                asset: linkedAsset,
                errorMessage: assetJob?.status === "failed" ? "资产图生成失败，请检查任务日志或重试。" : node.data?.errorMessage,
              },
            };
          }
          const sourceShotId = typeof node.data?.sourceShotId === "string" ? node.data.sourceShotId : undefined;
          const sourceShot = sourceShotId ? storyboardShots.find((shot) => shot.id === sourceShotId) : undefined;
          if (!sourceShot) return node;
          const videoNodeState = videoNodeStates[sourceShot.id];
          const sourceImageAssetId = sourceShot.imageAssetIds?.[0];
          const sourceVideoAssetId = sourceShot.videoAssetIds?.[0];
          const sourceImageUrl = sourceImageAssetId ? storedAssetUrlById.get(sourceImageAssetId) : undefined;
          const sourceFirstFrameUrl = sourceShot.firstFrameAssetId ? storedAssetUrlById.get(sourceShot.firstFrameAssetId) : undefined;
          const sourceVideoUrl = sourceVideoAssetId ? storedAssetUrlById.get(sourceVideoAssetId) : undefined;
          const syncedStatus: CanvasNode["status"] = node.type === "video" && videoNodeState?.status
            ? videoNodeState.status
            : sourceShot.status === "image_generating"
              ? "generating"
              : sourceShot.status === "image_ready" || (node.type === "video" && sourceShot.videoAssetIds?.length) || (node.type === "image" && sourceShot.imageAssetIds?.length)
                ? "done"
                : sourceShot.status === "failed" && node.type !== "video"
                  ? "error"
                  : node.status;
          return {
            ...node,
            status: syncedStatus,
            data: {
              ...node.data,
              videoPrompt: node.type === "video" ? sourceShot.videoPrompt || sourceShot.imagePrompt || "" : node.data?.videoPrompt,
              imagePrompt: sourceShot.imagePrompt || node.data?.imagePrompt || "",
              scene: sourceShot.scene || node.data?.scene || "",
              videoAssetIds: sourceShot.videoAssetIds || node.data?.videoAssetIds,
              imageAssetIds: sourceShot.imageAssetIds || node.data?.imageAssetIds,
              imageUrl: node.type === "image" ? sourceImageUrl || node.data?.imageUrl : node.data?.imageUrl,
              storyboardImageUrl: node.type === "shot" ? sourceImageUrl || node.data?.storyboardImageUrl : node.data?.storyboardImageUrl,
              firstFrameUrl: node.type === "video" ? sourceFirstFrameUrl : node.data?.firstFrameUrl,
              videoUrl: sourceVideoUrl || node.data?.videoUrl,
              errorMessage: node.type === "video" && videoNodeState?.status === "error" ? getSeedreamVideoErrorMessage(videoNodeState?.errorMessage) : node.data?.errorMessage,
            },
          };
        });
      const mergedNodes = [...nodes, ...manualStudioNodes];
      const nextNodes = hasCongestedShotLayout(mergedNodes) ? layoutStudioNodes(mergedNodes) : mergedNodes;
      return canvasNodesSignature(currentNodes) === canvasNodesSignature(nextNodes) ? currentNodes : nextNodes;
    });

    // 自动连线只连接画布上真实存在的产物节点；镜头数据不再作为画布节点参与连线。
    const conns: CanvasConnection[] = [];
    const sorted = [...activeEpisodeShots].sort((a, b) => a.index - b.index);

    sorted.forEach((shot) => {
      const hasImageNode = (shot.imageAssetIds && shot.imageAssetIds.length > 0) || shot.status === "image_generating";
      const videoNodeState = videoNodeStates[shot.id];
      const hasVideoNode = (shot.videoAssetIds && shot.videoAssetIds.length > 0) || videoNodeState?.status === "generating" || videoNodeState?.status === "error";
      const imageNodeId = `image-node-${shot.id}`;
      const videoNodeId = `video-node-${shot.id}`;
      if (hasImageNode && hasVideoNode && shot.firstFrameAssetId && shot.imageAssetIds?.includes(shot.firstFrameAssetId)) {
        conns.push({ id: `gen-image-video-${shot.id}`, from: imageNodeId, to: videoNodeId, label: "首帧", type: "generator" });
      }
    });
    setStudioConnections((currentConnections) => {
      const autoIds = new Set(conns.map((connection) => connection.id));
      const manualConnections = currentConnections.filter((connection) => !autoIds.has(connection.id) && connection.id.startsWith("manual-"));
      const nextConnections = [...manualConnections, ...conns];
      return canvasConnectionsSignature(currentConnections) === canvasConnectionsSignature(nextConnections) ? currentConnections : nextConnections;
    });
  }, [workflowScript, storyboardShots, activeEpisodeShots, activeEpisode, directorBlocks.length, generatorGroups, videoNodeStates, storedAssetUrlById, semanticAssets, generationJobs]);

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
      { label: "镜头列表", value: totalShots ? `${totalShots} 镜头` : "未解析", ok: totalShots > 0, hint: "故事板版应解析成镜头列表，而不是只留在原始文本里。" },
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
    router.replace("/ai-comic?tab=workflow", { scroll: false });
  };

  const openWorkflowStep = (mode: WorkflowMode) => {
    setTab("workflow");
    setWorkflowMode(mode);
    setWorkflowView("step");
    router.replace(`/ai-comic?tab=workflow&mode=${mode}`, { scroll: false });
  };

  const mergeStoryboardShots = (nextText: string, mode: "storyboard" | "seedance") => {
    const parsedShots = parseStoryboardShots(nextText, videoModel).map((shot) => ({ ...shot, episode: activeEpisode }));
    if (!parsedShots.length) {
      toast.error("没有解析到镜头/段落，请检查格式是否包含“段01”或“镜头1”。");
      return;
    }
    setStoryboardShots((prev) => {
      const currentEpisodeShots = prev.filter((shot) => Number(shot.episode || activeEpisode) === activeEpisode);
      const otherEpisodeShots = prev.filter((shot) => Number(shot.episode || activeEpisode) !== activeEpisode);
      const merged = parsedShots.map((shot, index) => {
        const existing = currentEpisodeShots[index];
        if (!existing) return shot;
        if (mode === "seedance") {
          return {
            ...existing,
            episode: activeEpisode,
            videoPrompt: shot.videoPrompt || existing.videoPrompt,
            dialogue: shot.dialogue || cleanLegacyDialogueNarration(existing.dialogue),
            narration: shot.narration || cleanLegacyDialogueNarration(existing.narration),
            duration: shot.duration || existing.duration,
            aspectRatio: shot.aspectRatio || existing.aspectRatio,
          };
        }
        return {
          ...existing,
          episode: activeEpisode,
          index: shot.index || index + 1,
          title: shot.title || existing.title,
          scene: shot.scene || existing.scene,
          characters: shot.characters.length ? shot.characters : existing.characters,
          dialogue: shot.dialogue,
          narration: shot.narration,
          imagePrompt: shot.imagePrompt || existing.imagePrompt,
          videoPrompt: shot.videoPrompt || existing.videoPrompt,
          generationActions: shot.generationActions || existing.generationActions,
          shotType: shot.shotType || existing.shotType,
          cameraMove: shot.cameraMove || existing.cameraMove,
          purpose: shot.purpose || existing.purpose,
          duration: shot.duration || existing.duration,
          aspectRatio: shot.aspectRatio || existing.aspectRatio,
        };
      });
      setActiveShotId(merged[0]?.id);
      return [...otherEpisodeShots, ...merged].sort((a, b) => (Number(a.episode || 1) - Number(b.episode || 1)) || a.index - b.index);
    });
    if (mode === "storyboard") setWorkflowStoryboardVideo(nextText);
    else setWorkflowStoryboardVideo((prev) => prev || nextText);
    openWorkflowStep("storyboardVideo");
    toast.success(`${mode === "storyboard" ? "故事板" : "Seedance投喂版"}已导入，并进入故事板生产台（${parsedShots.length} 条镜头）`);
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

  const isSupportedTextImportFile = (file: File) => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    return name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown") || type === "text/plain" || type === "text/markdown" || type === "text/x-markdown";
  };

  const readTextImportFile = (file: File, onText: (text: string) => void) => {
    if (!isSupportedTextImportFile(file)) {
      toast.error("仅支持 .txt / .md / .markdown 文本文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result || ""));
    reader.onerror = () => toast.error("读取文件失败");
    reader.readAsText(file, "utf-8");
  };

  const handleImportFile = (layer: "script" | "storyboard" | "seedance", event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    readTextImportFile(file, (text) => importLayerText(layer, text));
  };

  const handleImportScriptAndShotsFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    readTextImportFile(file, (text) => {
      const clean = stripWorkflowText(text);
      if (!clean) {
        toast.error("导入内容为空");
        return;
      }
      setWorkflowScript(clean);
      setScriptSourceExcerpt((prev) => prev || clean.slice(0, 2000));
      const parsedShots = parseStoryboardShots(clean, videoModel).map((shot) => ({ ...shot, episode: activeEpisode }));
      if (parsedShots.length) {
        setStoryboardShots(parsedShots);
        setActiveShotId(parsedShots[0]?.id);
        setWorkflowStoryboardVideo(clean);
        setWorkflowMode("storyboardImage");
        setWorkflowView("step");
        toast.success(`剧本已上传，并解析为 ${parsedShots.length} 条镜头列表`);
      } else {
        setWorkflowMode("script");
        setWorkflowView("step");
        toast.success(`剧本已上传，约 ${clean.length} 字，可继续拆成镜头列表`);
      }
    });
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
    const response = await apiFetch("/conversations", {
      method: "POST",
      body: JSON.stringify({
        title: workspaceProjectName || "漫剧项目",
        model: getWorkflowModel("ideaChat"),
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
    setModelStrategy(activeProject.modelStrategy || DEFAULT_WORKFLOW_MODEL_STRATEGY);
    setWorkflowModels({ ...DEFAULT_WORKFLOW_MODELS, ...(activeProject.workflowModels || {}) });
    // 已在画布工作过且保存了 flowStage="canvas" 的项目，切走再切回来应恢复画布，而不是被强制拉回剧本孵化。
    // 全新项目仍从 "idea" 开始；无生产数据的空项目也不自动进入画布。
    const hasCanvasContent =
      (activeProject.storyboardShots?.length || 0) > 0 ||
      (activeProject.canvasNodes?.length || 0) > 0 ||
      (activeProject.semanticAssets?.length || 0) > 0;
    const initialFlowStage: StoryFlowStage =
      hasCanvasContent
        ? "canvas"
        : activeProject.flowStage && activeProject.flowStage !== "canvas"
          ? activeProject.flowStage
          : activeProject.episodeScripts?.length
            ? "episodeScript"
            : activeProject.episodeOutlines?.length
              ? "outline"
              : activeProject.outlineSource
                ? "ideaContent"
                : "idea";
    setFlowStage(initialFlowStage);
    setOriginalIdea(activeProject.originalIdea || activeProject.idea || activeProject.scriptSourceExcerpt || "");
    const splitIdea = splitIdeaSourceAndReference(activeProject.outlineSource || "");
    setOutlineSource(splitIdea.outlineSource || activeProject.originalIdea || activeProject.idea || activeProject.scriptSourceExcerpt || "");
    setIdeaSourceReference(activeProject.ideaSourceReference || splitIdea.ideaSourceReference || "");
    setIdeaInput("");
    setIdeaChatMessages(activeProject.ideaChatMessages || []);
    setScriptSummary(activeProject.scriptSummary || DEFAULT_SCRIPT_SUMMARY);
    setEpisodeOutlines(activeProject.episodeOutlines || []);
    setEpisodeScripts(activeProject.episodeScripts || []);
    setActiveEpisode(activeProject.activeEpisode || 1);
    setWorkflowNovel(activeProject.novel || "");
    setScriptSourceExcerpt(activeProject.scriptSourceExcerpt || "");
    setScriptAdaptationInstruction(activeProject.scriptAdaptationInstruction || "");
    setWorkflowScript(extractVisibleEpisodeScript(activeProject.script || activeProject.episodeScripts?.find((item) => item.episode === (activeProject.activeEpisode || 1))?.script || ""));
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
    if (initialFlowStage === "canvas") {
      // 切到别处再切回来时，不能只恢复画布外壳；
      // 有镜头列表的项目应直接回到“分镜成片”生产检查，否则右侧会停在总览/其他步骤，看起来像镜头列表丢了。
      if (loadedShots.length > 0) {
        setWorkflowMode("storyboardImage");
        setWorkflowView("step");
      } else if ((activeProject.semanticAssets?.length || 0) > 0) {
        setWorkflowMode("assets");
        setWorkflowView("step");
      }
    }
    setGenerationJobs(activeProject.generationJobs || []);
    setSemanticAssets(activeProject.semanticAssets || []);
    setDirectorBlocks(activeProject.directorBlocks || []);
    setGeneratorGroups(activeProject.generatorGroups || []);
    setStudioNodes(activeProject.canvasNodes || []);
    setStudioConnections(activeProject.canvasConnections || []);
    setActiveSemanticAssetId(activeProject.semanticAssets?.[0]?.id);
    setLoadedProjectId(activeProject.id);
  }, [activeProject?.id]);


  useEffect(() => {
    if (!activeProject || loadedProjectId !== activeProject.id || cleanedAssetProjectIdsRef.current.has(activeProject.id)) return;
    const { assets: mergedAssets, idMap, removedCount } = mergeDuplicateSemanticAssets(semanticAssets);
    cleanedAssetProjectIdsRef.current.add(activeProject.id);
    if (!removedCount) return;

    setSemanticAssets(mergedAssets);
    setActiveSemanticAssetId((prev) => idMap.get(prev || "") || mergedAssets[0]?.id);
    setStoryboardShots((prev) => prev.map((shot) => ({
      ...shot,
      semanticAssetIds: remapSemanticAssetIds(shot.semanticAssetIds, idMap),
    })));
    setGenerationJobs((prev) => prev.map((job) => job.semanticAssetId
      ? { ...job, semanticAssetId: idMap.get(job.semanticAssetId) || job.semanticAssetId }
      : job));
    setDirectorBlocks((prev) => prev.map((block) => ({
      ...block,
      sceneBlock: {
        ...block.sceneBlock,
        sceneAssetId: block.sceneBlock.sceneAssetId ? idMap.get(block.sceneBlock.sceneAssetId) || block.sceneBlock.sceneAssetId : block.sceneBlock.sceneAssetId,
      },
      characters: block.characters.map((character) => ({
        ...character,
        semanticAssetId: idMap.get(character.semanticAssetId) || character.semanticAssetId,
      })),
    })));
    setStudioNodes((prev) => prev.map((node) => {
      const linkedAssetId = typeof node.data?.linkedAssetId === "string" ? node.data.linkedAssetId : undefined;
      if (!linkedAssetId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          linkedAssetId: idMap.get(linkedAssetId) || linkedAssetId,
        },
      };
    }));
    toast.success(`已清理资产库：合并 ${removedCount} 张重复资产卡`);
  }, [activeProject, loadedProjectId, semanticAssets]);


  useEffect(() => {
    if (!activeProject || loadedProjectId !== activeProject.id) return;
    setProjects((prev) => prev.map((project) => project.id === activeProject.id ? {
      ...project,
      title: activeProject.title,
      idea: workflowIdea,
      flowStage,
      modelStrategy,
      workflowModels,
      originalIdea,
      outlineSource,
      ideaSourceReference,
      ideaChatMessages,
      scriptSummary,
      episodeOutlines,
      episodeScripts,
      activeEpisode,
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
      generatorGroups,
      canvasNodes: studioNodes,
      canvasConnections: studioConnections,
      updatedAt: new Date().toISOString(),
    } : project));
  }, [activeProject?.id, loadedProjectId, workflowIdea, flowStage, modelStrategy, workflowModels, originalIdea, outlineSource, ideaSourceReference, ideaChatMessages, scriptSummary, episodeOutlines, episodeScripts, activeEpisode, workflowNovel, scriptSourceExcerpt, scriptAdaptationInstruction, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, assets, selectedAssetIds, imagePrompt, videoPrompt, storyboardShots, activeShotId, generationJobs, semanticAssets, directorBlocks, generatorGroups, studioNodes, studioConnections]);



  useEffect(() => {
    const succeededImages = images.filter((image) => image.image_url && (image.status === "succeeded" || image.status === "completed"));
    const failedImages = images.filter((image) => image.status === "failed");
    if (!succeededImages.length && !failedImages.length) return;
    setGenerationJobs((prev) => prev.map((job) => {
      if (job.type !== "image" || job.status !== "pending") return job;
      const failedImage = failedImages.find((item) => item.id === job.mediaId);
      if (failedImage) {
        if (job.shotId) updateShot(job.shotId, { status: "failed" });
        if (job.canvasNodeId) {
          setStudioNodes((current) => current.map((item) => item.id === job.canvasNodeId
            ? { ...item, status: "error", data: { ...item.data, errorMessage: getErrorMessage(failedImage.error_message || failedImage, { module: "image", fallbackMessage: "图片生成失败" }) } }
            : item));
        }
        return { ...job, status: "failed", updatedAt: new Date().toISOString() };
      }
      const image = succeededImages.find((item) => item.id === job.mediaId);
      if (!image) return job;
      const shot = storyboardShots.find((item) => item.id === job.shotId);
      const semanticAsset = semanticAssets.find((item) => item.id === job.semanticAssetId);
      const canvasNode = job.canvasNodeId ? studioNodes.find((item) => item.id === job.canvasNodeId) : undefined;
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
            ? {
                ...item,
                linkedAssetIds: Array.from(new Set([...(item.linkedAssetIds || []), assetIdToLink])),
                imageAssetId: assetIdToLink,
                imageUrl: asset.url,
              }
            : item));
        }
        if (canvasNode) {
          setStudioNodes((current) => current.map((item) => item.id === canvasNode.id
            ? {
                ...item,
                status: "done",
                data: {
                  ...item.data,
                  imageAssetId: assetIdToLink,
                  imageUrl: asset.url,
                  errorMessage: undefined,
                },
              }
            : item));
        }
      }
      return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    }));
  }, [images, storyboardShots, semanticAssets, assets, studioNodes]);

  useEffect(() => {
    const succeededVideos = videos.filter((video) => video.video_url && video.status === "succeeded");
    const failedVideos = videos.filter((video) => video.status === "failed");
    if (!succeededVideos.length && !failedVideos.length) return;
    setGenerationJobs((prev) => prev.map((job) => {
      if (job.type !== "video" || job.status !== "pending") return job;
      const failedVideo = failedVideos.find((item) => item.id === job.mediaId);
      if (failedVideo) {
        const errorMessage = getSeedreamVideoErrorMessage(failedVideo.error_message);
        if (job.shotId) {
          markStudioVideoProgress(job.shotId, "error", errorMessage);
        }
        return { ...job, status: "failed", updatedAt: new Date().toISOString() };
      }
      const video = succeededVideos.find((item) => item.id === job.mediaId);
      if (!video) return job;
      const shot = storyboardShots.find((item) => item.id === job.shotId);
      const asset = createAssetFromVideo(video, shot);
      if (asset && !assets.some((item) => item.publicId === asset.publicId && item.shotId === shot?.id)) {
        setAssets((current) => [asset, ...current]);
        if (shot) {
          updateShot(shot.id, { status: "video_ready", errorMessage: undefined, videoAssetIds: Array.from(new Set([...(shot.videoAssetIds || []), asset.id])), referenceVideoAssetId: shot.referenceVideoAssetId || asset.id });
          markStudioVideoProgress(shot.id, "done");
        }
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

  const selectedGeneratorGroup = useMemo(
    () => generatorGroups.find((group) => group.id === studioSelectedNodeId),
    [generatorGroups, studioSelectedNodeId],
  );

  const selectedStudioNode = useMemo(
    () => studioNodes.find((node) => node.id === studioSelectedNodeId),
    [studioNodes, studioSelectedNodeId],
  );

  const selectedComposerSettings = useMemo(() => {
    const sourceShotId = typeof selectedStudioNode?.data?.sourceShotId === "string"
      ? selectedStudioNode.data.sourceShotId
      : selectedStudioNode?.type === "shot"
        ? selectedStudioNode.id
        : undefined;
    const selectedShot = sourceShotId ? storyboardShots.find((shot) => shot.id === sourceShotId) : undefined;
    return {
      imageAspect: selectedShot?.aspectRatio || imageAspect,
      imageResolution,
      assetPreset,
      videoModel,
      videoAspect: selectedShot?.aspectRatio || videoAspect,
      videoResolution: normalizeVideoResolution(videoResolution, selectedGeneratorGroup?.modelLabel || videoModel),
      videoDuration: normalizeVideoDuration(selectedShot?.duration || selectedGeneratorGroup?.duration || videoDuration, selectedGeneratorGroup?.modelLabel || videoModel),
      videoAudio,
    };
  }, [assetPreset, imageAspect, imageResolution, selectedGeneratorGroup?.duration, selectedStudioNode, storyboardShots, videoAspect, videoAudio, videoDuration, videoModel, videoResolution]);

  const selectedGeneratorQueue = useMemo(() => {
    if (!selectedGeneratorGroup) return [];
    const idSet = new Set(selectedGeneratorGroup.shotIds);
    return storyboardShots.filter((shot) => idSet.has(shot.id)).sort((a, b) => a.index - b.index);
  }, [selectedGeneratorGroup, storyboardShots]);


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

  const getActiveEpisodeScriptForGeneration = () => {
    const activeScript = episodeScripts.find((item) => item.episode === activeEpisode);
    const sceneText = activeScript?.scenes?.length
      ? `【结构化场次 JSON】\n${JSON.stringify(activeScript.scenes, null, 2)}`
      : "";
    const scriptText = workflowScript.trim() || activeScript?.script || workflowNovel.trim() || workflowIdea.trim();
    return [scriptText ? `【剧本正文】\n${scriptText}` : "", sceneText].filter(Boolean).join("\n\n");
  };

  const getActiveCanvasShotsForAssetExtraction = () => activeEpisodeShots.length
    ? `【当前镜头列表】\n${JSON.stringify(activeEpisodeShots.map((shot) => ({
      index: shot.index,
      title: shot.title,
      scene: shot.scene,
      characters: shot.characters,
      shotType: shot.shotType,
      purpose: shot.purpose,
      imagePrompt: shot.imagePrompt,
      videoPrompt: shot.videoPrompt,
    })), null, 2)}`
    : "";

  const getScriptOutlineForAssetExtraction = () => [
    scriptSummary.charactersText ? `【剧本大纲｜人物小传】\n${scriptSummary.charactersText}` : "",
    scriptSummary.genre || scriptSummary.coreHook || scriptSummary.logline || scriptSummary.synopsis
      ? `【剧本大纲｜摘要】\n类型：${scriptSummary.genre || ""}\n核心梗：${scriptSummary.coreHook || ""}\n一句话故事：${scriptSummary.logline || ""}\n故事梗概：${scriptSummary.synopsis || ""}`
      : "",
    episodeOutlines.length
      ? `【剧本大纲｜分集梗概】\n${episodeOutlines.map((episode) => `第${episode.episode}集｜${episode.title}\n${episode.summary}`).join("\n\n")}`
      : "",
  ].filter(Boolean).join("\n\n");

  const getAssetExtractionSourceInput = () => [
    getScriptOutlineForAssetExtraction(),
    getActiveEpisodeScriptForGeneration(),
    getActiveCanvasShotsForAssetExtraction(),
    workflowIdea.trim() ? `【原始创意】\n${workflowIdea.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  const buildWorkflowInput = (mode: WorkflowMode) => {
    if (mode === "novel") return workflowIdea.trim();
    if (mode === "script") {
      const excerpt = scriptSourceExcerpt.trim();
      const instruction = scriptAdaptationInstruction.trim();
      const source = excerpt || workflowIdea.trim();
      if (!source) return "";
      return `【本集大概内容】\n${source}\n\n【剧本生成要求】\n${instruction || "改成适合竖屏漫剧的一集/一段影视剧本；只基于上面的本集大概内容生成，不读取、不等待、不假设整本小说素材。"}`;
    }
    const activeEpisodeScriptForGeneration = getActiveEpisodeScriptForGeneration();
    if (mode === "assets") {
      const source = getAssetExtractionSourceInput();
      if (!source.trim()) return "";
      return `【资产提取预设提示词】\n${assetExtractInstruction.trim() || DEFAULT_ASSET_EXTRACT_INSTRUCTION}\n\n【剧情材料】\n${source}`;
    }
    if (mode === "storyboardVideo") return `【剧本】\n${activeEpisodeScriptForGeneration || workflowIdea.trim()}\n\n【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}`;
    return `【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}\n\n【分镜/剧本】\n${workflowStoryboardVideo.trim() || activeEpisodeScriptForGeneration || workflowIdea.trim()}`;
  };


  const getWorkflowModeModel = (mode: WorkflowMode) => {
    if (mode === "script") return getWorkflowModel("episodeScript");
    if (mode === "assets") return getWorkflowModel("assetExtract");
    if (mode === "storyboardVideo") return getWorkflowModel("storyboardVideoPrompt");
    if (mode === "storyboardImage") return getWorkflowModel("storyboardImagePrompt");
    return getWorkflowModel("episodeScript");
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
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModeModel(mode),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: buildWorkflowSystemPrompt(mode) },
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
        setAssetPreprocessOpen(true);
        if (parsedAssets.length > 0) {
          setAssetCandidates(parsedAssets.map((asset) => ({ ...asset, selected: true })));
          setActiveSemanticAssetId(parsedAssets[0].id);
          toast.success("已提取资产候选，请确认或修改后录入资产库");
        } else {
          toast.message("已打开资产预处理，可查看模型原始输出或手动补资产描述");
        }
      }
      if (mode === "storyboardVideo" || mode === "storyboardImage") {
        const parsedShots = parseStoryboardShots(clean, videoModel).map((shot) => ({ ...shot, episode: activeEpisode }));
        if (parsedShots.length > 0) {
          let nextActiveShotId = parsedShots[0]?.id;
          setStoryboardShots((prev) => {
            const currentEpisodeShots = prev.filter((shot) => Number(shot.episode || activeEpisode) === activeEpisode);
            const otherEpisodeShots = prev.filter((shot) => Number(shot.episode || activeEpisode) !== activeEpisode);
            const nextEpisodeShots = !currentEpisodeShots.length ? parsedShots : parsedShots.map((shot, index) => {
              const existing = currentEpisodeShots[index];
              return {
                ...existing,
                ...shot,
                episode: activeEpisode,
                id: existing?.id || shot.id,
                referenceAssetIds: existing?.referenceAssetIds || shot.referenceAssetIds,
                imageAssetIds: existing?.imageAssetIds || [],
                videoAssetIds: existing?.videoAssetIds || [],
                status: existing?.status || shot.status,
                imagePrompt: shot.imagePrompt || existing?.imagePrompt || "",
                videoPrompt: shot.videoPrompt || existing?.videoPrompt || "",
                generationActions: shot.generationActions || existing?.generationActions,
              };
            });
            nextActiveShotId = nextEpisodeShots[0]?.id;
            return [...otherEpisodeShots, ...nextEpisodeShots].sort((a, b) => (Number(a.episode || 1) - Number(b.episode || 1)) || a.index - b.index);
          });
          setActiveShotId((prev) => prev || nextActiveShotId);
          toast.success(`已生成文字分镜，并自动解析为 ${parsedShots.length} 条镜头列表`);
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

  const chatAboutIdea = async () => {
    const question = ideaInput.trim();
    if (!question) {
      toast.error("先输入你想聊的剧本想法");
      return;
    }
    const userMessage: ScriptChatMessage = { id: `idea-u-${Date.now()}`, role: "user", content: question };
    const assistantId = `idea-a-${Date.now()}`;
    const history = [...ideaChatMessages, userMessage];
    setIdeaInput("");
    setIdeaChatMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setIdeaChatting(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("ideaChat"),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: "你是短剧开发顾问。目标是和用户把短剧想法聊清楚，再沉淀成可生成大纲的原始创意。多问关键缺口：类型、核心钩子、主角处境、人物关系、集数、目标受众、情绪曲线、结尾钩子。不要写小说正文，不要直接生成完整分镜。回复简洁，优先给2-4个可选方向。" },
            { role: "user", content: history.map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join("\n") },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const answer = stripWorkflowText(raw);
      setIdeaChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: answer } : msg));
      if (!originalIdea.trim() && question) {
        setOriginalIdea(question);
        setWorkflowIdea(question);
      }
    } catch (err) {
      const message = getErrorMessage(err, { module: "chat", fallbackMessage: "聊剧本失败" });
      toast.error(message);
      setIdeaChatMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, content: `失败：${message}` } : msg));
    } finally {
      setIdeaChatting(false);
    }
  };

  const extractEffectiveIdeaForOutline = async (sourceMessages: ScriptChatMessage[], typedIdea: string, existingBrief: string) => {
    const transcript = sourceMessages.map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join("\n");
    const lastUserContent = [...sourceMessages].reverse().find((msg) => msg.role === "user")?.content?.trim() || typedIdea || existingBrief;
    if (!transcript.trim()) return { outlineSource: typedIdea || existingBrief, ideaSourceReference: "" };
    const conversationId = await ensureWorkflowConversationId();
    const response = await fetchWorkflowChatRequest({
      method: "POST",
      body: JSON.stringify({
        model: getWorkflowModel("ideaExtract"),
        conversation_id: conversationId,
        stream: true,
        search: false,
        reasoning: false,
        messages: [
          { role: "system", content: buildEffectiveIdeaSystemPrompt() },
          { role: "user", content: `【AI聊剧本完整对话】\n${transcript}\n\n【用户最后明确给出/认可的剧情内容】\n${lastUserContent || "无"}\n\n【当前补充输入】\n${typedIdea || "无"}\n\n请只提取最终确认的有效创意。被用户否决、放弃、推翻的内容不要进入 outlineSource。特别注意：如果【用户最后明确给出/认可的剧情内容】里有具体剧情流程、桥段、行动步骤或结尾钩子，必须逐条保留到【剧情流程｜逐场细节版】或【关键桥段｜不可丢失细节】中。不要把剧情抽成摘要，不要删除原文里的具体执行信息：人物如何移动、处在什么空间位置、使用或观察了什么道具/物件、和谁/什么互动、哪句话或哪个动作触发了后果、事件先后顺序如何变化。` },
        ],
      }),
    });
    if (!response.ok) throw await readApiError(response);
    const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
      ? await consumeChatStream(response)
      : extractTextFromChatResponse(await response.json());
    const parsedIdea = parseEffectiveIdeaResult(raw) || typedIdea || existingBrief || transcript;
    const splitIdea = splitIdeaSourceAndReference(parsedIdea);
    const referenceFromModel = splitIdea.ideaSourceReference;
    const shouldPreserveLastPlot = lastUserContent.length >= 80 && !splitIdea.outlineSource.includes(lastUserContent.slice(0, 40));
    return {
      outlineSource: splitIdea.outlineSource || parsedIdea,
      ideaSourceReference: referenceFromModel || (shouldPreserveLastPlot ? lastUserContent : ""),
    };
  };

  const extractEffectiveIdeaContent = async () => {
    const typedIdea = ideaInput.trim();
    const existingBrief = outlineSource.trim() || originalIdea.trim() || workflowIdea.trim();
    const userText = typedIdea || existingBrief;
    if (!userText && !ideaChatMessages.length) {
      toast.error("先聊一下剧本内容，比如类型、核心梗、集数和主角处境");
      return;
    }
    const nextUserMessage: ScriptChatMessage = { id: `idea-u-${Date.now()}`, role: "user", content: typedIdea || userText };
    const sourceMessages = [...ideaChatMessages, ...(typedIdea ? [nextUserMessage] : [])];
    if (typedIdea) setIdeaChatMessages(sourceMessages);
    setIdeaInput("");
    setIdeaExtracting(true);
    try {
      const extractedIdea = await extractEffectiveIdeaForOutline(sourceMessages, typedIdea, existingBrief);
      setOutlineSource(extractedIdea.outlineSource);
      setIdeaSourceReference(extractedIdea.ideaSourceReference);
      setOriginalIdea(extractedIdea.outlineSource);
      setWorkflowIdea(extractedIdea.outlineSource);
      setScriptSourceExcerpt(extractedIdea.outlineSource.slice(0, 2000));
      setFlowStage("ideaContent");
      toast.success("已提炼最终有效创意，请确认后生成剧本大纲");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "创意内容提炼失败" }));
    } finally {
      setIdeaExtracting(false);
    }
  };

  const generateScriptOutlineFromIdea = async () => {
    const effectiveIdea = outlineSource.trim() || originalIdea.trim() || workflowIdea.trim();
    if (!effectiveIdea) {
      toast.error("先提炼并确认创意内容");
      setFlowStage("idea");
      return;
    }
    setOutlineGenerating(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("outline"),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: buildScriptOutlineSystemPrompt() },
            { role: "user", content: `【最终确认的有效创意】\n${effectiveIdea}\n\n【默认要求】\n集数：${scriptSummary.episodeCount || 5}\n目标受众：${scriptSummary.targetAudience || "大众"}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const parsed = parseScriptOutlineResult(raw);
      setScriptSummary(parsed.summary);
      setEpisodeOutlines(parsed.episodes);
      setOutlineSource(effectiveIdea);
      setOriginalIdea(effectiveIdea);
      setWorkflowIdea(effectiveIdea);
      setWorkflowScript(parsed.summary.synopsis || effectiveIdea);
      setScriptSourceExcerpt(effectiveIdea.slice(0, 2000));
      setFlowStage("outline");
      toast.success(`已生成剧本大纲${parsed.episodes.length ? `（${parsed.episodes.length} 集）` : ""}`);
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "剧本大纲生成失败" }));
    } finally {
      setOutlineGenerating(false);
    }
  };

  const generateEpisodeScript = async (outline: EpisodeOutline) => {
    setEpisodeScriptGenerating(outline.episode);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("episodeScript"),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: buildEpisodeScriptSystemPrompt() },
            { role: "user", content: `【最终有效创意】\n${outlineSource || originalIdea || workflowIdea}\n\n【剧本摘要】\n${JSON.stringify(scriptSummary, null, 2)}\n\n【完整剧本大纲 / 全部分集】\n${JSON.stringify(episodeOutlines, null, 2)}\n\n【本次要生成正文的分集】\n${JSON.stringify(outline, null, 2)}\n\n要求：本集正文必须服从最终有效创意和完整剧本大纲，不能只根据本集简介自由发挥；必须承接前后集的因果、人物关系和悬念安排。` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const episodeScript = parseEpisodeScriptResult(raw, outline);
      setEpisodeScripts((prev) => {
        const rest = prev.filter((item) => item.episode !== episodeScript.episode);
        return [...rest, episodeScript].sort((a, b) => a.episode - b.episode);
      });
      setWorkflowScript(extractVisibleEpisodeScript(episodeScript.script));
      setActiveEpisode(episodeScript.episode);
      setFlowStage("episodeScript");
      toast.success(`已生成${outline.title || `第${outline.episode}集`}正文`);
      return episodeScript;
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "分集正文生成失败" }));
      return null;
    } finally {
      setEpisodeScriptGenerating(null);
    }
  };

  const confirmOutlineAndGenerateFirstEpisode = async () => {
    if (!episodeOutlines.length) {
      toast.error("先生成或填写分集剧本");
      return;
    }
    await generateEpisodeScript(episodeOutlines[0]);
  };

  const enterEpisodeCanvas = async (episode = activeEpisode) => {
    const existing = episodeScripts.find((item) => item.episode === episode);
    if (!existing) {
      const outline = episodeOutlines.find((item) => item.episode === episode) || episodeOutlines[0];
      if (!outline) return;
      const generated = await generateEpisodeScript(outline);
      if (!generated) return;
      setWorkflowScript(extractVisibleEpisodeScript(generated.script));
    } else {
      setWorkflowScript(extractVisibleEpisodeScript(existing.script));
    }
    setActiveEpisode(episode);
    setFlowStage("canvas");
    setWorkflowMode("storyboardVideo");
    setWorkflowView("step");
    if (!storyboardShots.length) {
      const generated = await generateWorkflow("storyboardVideo");
      if (generated) setWorkflowMode("storyboardImage");
    }
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
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("scriptRewrite"),
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
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("scriptRewrite"),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: "你是影视剧本精修改稿助手。重点负责强钩子、对白重写、节奏压缩、人物动机和悬念升级；严格根据用户修改意见重写剧本；保留未要求改动的剧情、人物关系和已定台词。不要解释，不要 Markdown 代码块。必须输出与分集正文一致的严格 JSON：{\"episode\":1,\"title\":\"第1集\",\"script\":\"给人阅读的完整剧本正文\",\"scenes\":[{\"scene\":1,\"title\":\"\",\"location\":\"\",\"time\":\"\",\"characters\":[\"\"],\"visual_action\":\"\",\"dialogue\":[{\"character\":\"\",\"text\":\"\",\"tone\":\"\"}],\"narration\":\"\",\"emotion\":\"\",\"hook\":\"\"}]}。script 与 scenes 必须一致。" },
            { role: "user", content: `【当前剧本与结构】
${getActiveEpisodeScriptForGeneration() || baseScript}

【修改意见】
${instruction}` },
          ],
        }),
      });
      if (!response.ok) throw await readApiError(response);
      const raw = response.headers.get("content-type")?.includes("text/event-stream") && response.body
        ? await consumeChatStream(response)
        : extractTextFromChatResponse(await response.json());
      const outline = episodeOutlines.find((item) => item.episode === activeEpisode) || { episode: activeEpisode, title: `第${activeEpisode}集`, summary: "" };
      const revisedEpisode = parseEpisodeScriptResult(raw, outline);
      setWorkflowScript(revisedEpisode.script);
      setEpisodeScripts((prev) => prev.map((item) => item.episode === activeEpisode ? { ...item, ...revisedEpisode, status: "done" } : item));
      setWorkflowMode("script");
      if (!overrideInstruction) setScriptRevisionInstruction("");
      toast.success("剧本已按修改意见更新");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: "修改剧本失败" }));
    } finally {
      setScriptRevising(false);
    }
  };

  const chatAboutAsset = async (asset: SemanticAsset, overrideQuestion?: string) => {
    const question = (overrideQuestion ?? assetChatInput).trim();
    if (!question) {
      toast.error("先输入想聊什么");
      return;
    }
    const userMessage: ScriptChatMessage = { id: `asset-u-${Date.now()}`, role: "user", content: question };
    const assistantId = `asset-a-${Date.now()}`;
    if (!overrideQuestion) setAssetChatInput("");
    setAssetChatMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setAssetChatting(true);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("assetExtract"),
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

  const regenerateSemanticAsset = async (asset: SemanticAsset, overrideInstruction?: string) => {
    const instruction = (overrideInstruction ?? assetRegenerateInstruction).trim();
    setAssetRegeneratingId(asset.id);
    try {
      const conversationId = await ensureWorkflowConversationId();
      const response = await fetchWorkflowChatRequest({
        method: "POST",
        body: JSON.stringify({
          model: getWorkflowModel("assetExtract"),
          conversation_id: conversationId,
          stream: true,
          search: false,
          reasoning: false,
          messages: [
            { role: "system", content: '你是 Seedream/Seedance 前期资产设定助手。根据剧本、当前资产和用户补充要求，重新生成单个资产。只输出 JSON，不要代码块。格式：{"summary":"","lock_prompt":"","negative_prompt":""}。summary 是给用户看的中文资产描述；lock_prompt 是中文生图一致性锁定词；negative_prompt 是中文禁用项。人物资产只能写外貌定妆：年龄段、体型、脸部气质、发型、服装、随身物、标志性姿态、可视化痕迹；禁止写团队职责、人物关系、性格弧线、通关结局、剧情作用、规则解释、内心动机、能力强弱。场景/道具/风格也只写可直接画出来的信息。' },
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

  const resolveSemanticAssetFromNode = (nodeId: string) => {
    const node = studioNodes.find((item) => item.id === nodeId);
    const linkedAssetId = typeof node?.data?.linkedAssetId === "string" ? node.data.linkedAssetId : node?.id;
    const asset = semanticAssets.find((item) => item.id === linkedAssetId);
    if (!asset) toast.error("当前画布节点没有绑定可改写的资产库卡片");
    return asset;
  };

  const handleRewriteNodeAsset = (nodeId: string, instruction: string) => {
    const asset = resolveSemanticAssetFromNode(nodeId);
    if (!asset) return;
    regenerateSemanticAsset(asset, instruction);
  };

  const handleChatNodeAsset = (nodeId: string, question: string) => {
    const asset = resolveSemanticAssetFromNode(nodeId);
    if (!asset) return;
    chatAboutAsset(asset, question);
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
      const response = await apiFetch("/files/upload", {
        method: "POST",
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
      lastFrameAssetId: shot.lastFrameAssetId === id ? undefined : shot.lastFrameAssetId,
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

  const markStudioVideoProgress = (shotId: string, status: CanvasNode["status"], errorMessage?: string) => {
    setVideoNodeStates((prev) => ({
      ...prev,
      [shotId]: { status, errorMessage: status === "error" ? errorMessage : undefined },
    }));
    setStudioNodes((prev) => prev.map((node) => {
      const sourceShotId = typeof node.data?.sourceShotId === "string"
        ? node.data.sourceShotId
        : node.id.startsWith("video-node-")
          ? node.id.replace("video-node-", "")
          : undefined;
      return node.type === "video" && sourceShotId === shotId
        ? { ...node, status, data: { ...node.data, errorMessage: status === "error" ? errorMessage : undefined } }
        : node;
    }));
  };

  const addShot = () => {
    const shot = createShot(activeEpisodeShots.length + 1, { episode: activeEpisode });
    setStoryboardShots((prev) => [...prev, shot]);
    setActiveShotId(shot.id);
  };

  const deleteShot = (id: string) => {
    setStoryboardShots((prev) => prev.filter((shot) => shot.id !== id).map((shot, index) => ({ ...shot, index: index + 1 })));
    if (activeShotId === id) setActiveShotId(storyboardShots.find((shot) => shot.id !== id)?.id);
  };

  const reorderShots = (orderedIds: string[]) => {
    setStoryboardShots((prev) => {
      const order = new Map(orderedIds.map((id, index) => [id, index]));
      return [...prev]
        .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
        .map((shot, index) => ({ ...shot, index: index + 1 }));
    });
  };

  const rebuildShotsFromOutputs = () => {
    const parsed = parseStoryboardShots(workflowStoryboardImage.trim() || workflowStoryboardVideo.trim(), videoModel);
    if (!parsed.length) {
      toast.error("没有可解析的分镜输出，请先生成视频/图片分镜提示词");
      return;
    }
    setStoryboardShots(parsed);
    setActiveShotId(parsed[0]?.id);
    toast.success(`已生成 ${parsed.length} 条镜头列表`);
  };

  const rebuildSemanticAssetsFromOutput = () => {
    const parsed = parseSemanticAssets(workflowAssets.trim());
    if (!parsed.length) {
      toast.error("没有可解析的资产输出，请先生成资产文本");
      return;
    }
    setAssetCandidates(parsed.map((asset) => ({ ...asset, selected: true })));
    setAssetPreprocessOpen(true);
    toast.success(`已解析 ${parsed.length} 个资产候选，请确认后录入资产库`);
  };

  const updateAssetCandidate = (id: string, patch: Partial<AssetCandidate>) => {
    setAssetCandidates((prev) => prev.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
  };

  const applySelectedAssetCandidates = () => {
    const selected = assetCandidates.filter((asset) => asset.selected);
    if (!selected.length) {
      toast.error("请先勾选要录入资产库的资产");
      return;
    }
    const makeAssetKey = (asset: Pick<SemanticAsset, "kind" | "name">) => `${asset.kind}::${asset.name.trim().replace(/\s+/g, "").toLowerCase()}`;
    const normalized = selected.map(({ selected: _selected, ...asset }) => ({
      ...asset,
      id: asset.id || `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      linkedAssetIds: asset.linkedAssetIds || [],
      createdAt: asset.createdAt || new Date().toISOString(),
    }));

    let addedCount = 0;
    let updatedCount = 0;
    let firstActiveId = normalized[0]?.id;
    setSemanticAssets((prev) => {
      const merged = [...prev];
      normalized.forEach((asset) => {
        const key = makeAssetKey(asset);
        const existingIndex = merged.findIndex((item) => makeAssetKey(item) === key || item.id === asset.id);
        if (existingIndex >= 0) {
          const existing = merged[existingIndex];
          merged[existingIndex] = {
            ...existing,
            kind: asset.kind,
            name: asset.name,
            summary: asset.summary,
            lockPrompt: asset.lockPrompt,
            negativePrompt: asset.negativePrompt,
            // 保留已生成图片、已绑定素材、创建时间，避免重新提取覆盖生产成果。
            linkedAssetIds: existing.linkedAssetIds || asset.linkedAssetIds || [],
            imageAssetId: existing.imageAssetId,
            imageUrl: existing.imageUrl,
            createdAt: existing.createdAt || asset.createdAt,
          };
          firstActiveId = existing.id;
          updatedCount += 1;
        } else {
          const nextAsset: SemanticAsset = {
            ...asset,
            id: `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            imageUrl: undefined,
            imageAssetId: undefined,
          };
          merged.unshift(nextAsset);
          firstActiveId = nextAsset.id;
          addedCount += 1;
        }
      });
      return merged;
    });
    setActiveSemanticAssetId(firstActiveId);
    setAssetKindFilter(normalized[0]?.kind || "all");
    setAssetCandidates((prev) => prev.filter((asset) => !asset.selected));
    setAssetPreprocessOpen(false);
    toast.success(`已更新 ${updatedCount} 个、录入 ${addedCount} 个资产；可继续修改后再手动生成图`);
  };

  const createSemanticAssetDraft = (kind: SemanticAssetKind = "character", name?: string): SemanticAsset => ({
    id: `semantic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: name || `新${getSemanticAssetKindLabel(kind)}`,
    summary: "",
    lockPrompt: "",
    negativePrompt: "",
    linkedAssetIds: [],
    createdAt: new Date().toISOString(),
  });

  const addSemanticAsset = (kind: SemanticAssetKind = "character") => {
    const asset = createSemanticAssetDraft(kind);
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
    setVideoDuration(normalizeVideoDuration(shot.duration || videoDuration, videoModel));
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

  const generateSemanticAssetImage = async (asset: SemanticAsset, mode: "default" | "character-turnaround" = "default") => {
    const prompt = buildSemanticAssetImagePrompt(asset, mode).trim();
    if (!prompt) return toast.error("资产缺少可用于生图的描述");
    setAssetImageGeneratingId(asset.id);
    try {
      // 资产图生成必须走 Seedream 文生图。不要自动把已有资产图作为 reference_image_urls 传入：
      // 当前后端一旦收到参考图会进入图片编辑链路，而不是 Seedream 文生图，导致已有资产“重新生成”稳定失败。
      const data = await generateImage(prompt, imageAspect, imageResolution, SEEDREAM_IMAGE_QUALITY, [], "seedream");
      setLastImageId(data.id);
      addGenerationJob({ id: `job-asset-image-${data.id}-${Date.now()}`, semanticAssetId: asset.id, type: "image", mediaId: data.id, prompt, status: "pending", intent: "asset_image", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      toast.success(mode === "character-turnaround" ? "已提交角色三视图生成任务，完成后会自动关联到该角色资产" : asset.kind === "character" ? "已提交角色设定图生成任务，完成后会自动关联到该角色资产" : "已提交资产图生成任务，完成后会自动关联到该资产");
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "image", fallbackMessage: mode === "character-turnaround" ? "角色三视图生成失败" : "资产图生成失败" }));
    } finally {
      setAssetImageGeneratingId(null);
    }
  };

  const generateNodeAssetImage = async (nodeId: string) => {
    const node = studioNodes.find((item) => item.id === nodeId);
    const linkedAssetId = typeof node?.data?.linkedAssetId === "string" ? node.data.linkedAssetId : nodeId;
    const existingAsset = semanticAssets.find((asset) => asset.id === linkedAssetId);
    if (!existingAsset) return;
    await generateSemanticAssetImage(existingAsset, "default");
  };

  const buildImagePromptForGeneration = (shot: StoryboardShot) => {
    const directorBlock = findDirectorBlockForShot(directorBlocks, shot.id);
    const base = shot.imagePrompt?.trim() || buildStructuredShotImagePrompt(shot);
    return base ? injectDirectorBlockToPrompt(base, directorBlock, semanticAssets) : "";
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

  const generateCanvasImageNode = async (node: CanvasNode) => {
    const prompt = String(node.data?.imagePrompt || node.data?.scene || node.data?.content || "").trim();
    if (!prompt) {
      toast.error("图片节点缺少提示词");
      return null;
    }
    const referenceAssetId = typeof node.data?.referenceAssetId === "string" ? node.data.referenceAssetId : "";
    const referenceImageUrl = typeof node.data?.referenceImageUrl === "string" ? node.data.referenceImageUrl : "";
    const assetRef = referenceAssetId ? assets.find((asset) => asset.id === referenceAssetId || asset.publicId === referenceAssetId) : undefined;
    const refs = [assetRef?.publicId || assetRef?.url || referenceImageUrl].filter(Boolean) as string[];
    setStudioNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, status: "generating", data: { ...item.data, errorMessage: undefined } } : item));
    try {
      const data = await generateImage(prompt, imageAspect, imageResolution, SEEDREAM_IMAGE_QUALITY, refs, "seedream");
      setLastImageId(data.id);
      addGenerationJob({
        id: `job-canvas-image-${data.id}-${Date.now()}`,
        canvasNodeId: node.id,
        type: "image",
        mediaId: data.id,
        prompt,
        status: "pending",
        intent: "canvas_image",
        entryPath: "canvas",
        promptSource: "canvasPrompt",
        referenceImageCount: refs.length,
        referenceVideoCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success(refs.length ? "已提交参考图生图任务" : "已提交图片生成任务");
      return data;
    } catch (err) {
      setStudioNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, status: "error", data: { ...item.data, errorMessage: getErrorMessage(err, { module: "image", fallbackMessage: "图片生成失败" }) } } : item));
      throw err;
    }
  };

  const generateCanvasVideoNode = async (node: CanvasNode) => {
    const prompt = String(node.data?.videoPrompt || node.data?.content || "").trim();
    if (!prompt) {
      toast.error("视频节点缺少视频提示词");
      return null;
    }
    const firstFrameAssetId = typeof node.data?.firstFrameAssetId === "string" ? node.data.firstFrameAssetId : "";
    const firstFrameUrl = typeof node.data?.firstFrameUrl === "string" ? node.data.firstFrameUrl : "";
    const assetRef = firstFrameAssetId ? assets.find((asset) => asset.id === firstFrameAssetId || asset.publicId === firstFrameAssetId) : undefined;
    const references = buildSeedanceVideoReferences({
      mode: firstFrameAssetId || firstFrameUrl ? "image_to_video" : "text_to_video",
      images: [assetReferenceUrl(assetRef) || firstFrameUrl],
    });
    setStudioNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, status: "generating", data: { ...item.data, errorMessage: undefined } } : item));
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: videoAspect,
        duration: normalizeVideoDuration(videoDuration, videoModel),
        resolution: normalizeVideoResolution(videoResolution, videoModel),
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: references.reference_image_urls,
        reference_image_roles: references.reference_image_roles,
        reference_image_role_mode: references.reference_image_role_mode,
      });
      setLastVideoId(data.id);
      addGenerationJob({
        id: `job-canvas-video-${data.id}-${Date.now()}`,
        canvasNodeId: node.id,
        type: "video",
        mediaId: data.id,
        prompt,
        status: "pending",
        entryPath: "canvas",
        promptSource: "canvasPrompt",
        referenceImageCount: references.reference_image_urls?.length || 0,
        referenceVideoCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success(references.reference_image_urls?.length ? "已提交图生视频任务" : "已提交文生视频任务");
      return data;
    } catch (err) {
      setStudioNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, status: "error", data: { ...item.data, errorMessage: getErrorMessage(err, { module: "video", fallbackMessage: "视频生成提交失败" }) } } : item));
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
    const rawPrompt = shot.videoPrompt.trim();
    const prompt = injectDirectorBlockToPrompt(rawPrompt, findDirectorBlockForShot(directorBlocks, shot.id), semanticAssets);
    if (!prompt) {
      toast.error("镜头缺少视频提示词");
      return null;
    }
    setActiveShotId(shot.id);
    markStudioVideoProgress(shot.id, "generating");
    const refs = getShotAssets(shot, assets);
    const videoCandidateImages = refs.filter((asset) => asset.type === "image" && !isStoryboardSketchAsset(asset) && VIDEO_REFERENCE_ROLES.has(asset.role || "reference_image"));
    const firstFrameAsset = shot.firstFrameAssetId
      ? videoCandidateImages.find((asset) => asset.id === shot.firstFrameAssetId || asset.publicId === shot.firstFrameAssetId)
      : undefined;
    const lastFrameAsset = shot.lastFrameAssetId
      ? videoCandidateImages.find((asset) => asset.id === shot.lastFrameAssetId || asset.publicId === shot.lastFrameAssetId)
      : undefined;
    const hasReferenceVideos = refs.some((asset) => asset.type === "video");
    const references = buildSeedanceVideoReferences({
      // 有参考视频时走全能参考模式，首帧/尾帧语义注入 prompt 文本
      // 无参考视频时，有首尾帧走首尾帧模式，有图走图生视频
      mode: hasReferenceVideos ? "omni_reference" : firstFrameAsset && lastFrameAsset ? "first_last_frame" : videoCandidateImages.length ? "image_to_video" : "text_to_video",
      images: videoCandidateImages.map(assetReferenceUrl),
      firstFrame: assetReferenceUrl(firstFrameAsset),
      lastFrame: assetReferenceUrl(lastFrameAsset),
      videos: refs.filter((asset) => asset.type === "video").map(assetReferenceUrl),
    });
    const videoAssets = refs.filter((asset) => asset.type === "video");
    const finalPrompt = references.promptInjection ? `${references.promptInjection} ${prompt}` : prompt;
    try {
      const data = await generateVideo({
        prompt: finalPrompt,
        model: videoModel,
        ratio: shot.aspectRatio || videoAspect,
        duration: normalizeVideoDuration(shot.duration || videoDuration, videoModel),
        resolution: normalizeVideoResolution(videoResolution, videoModel),
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: references.reference_image_urls,
        reference_image_roles: references.reference_image_roles,
        reference_video_urls: references.reference_video_urls,
        reference_image_role_mode: references.reference_image_role_mode,
      });
      setLastVideoId(data.id);
      addGenerationJob({ id: `job-video-${data.id}-${Date.now()}`, shotId: shot.id, type: "video", mediaId: data.id, prompt: finalPrompt, status: "pending", entryPath, promptSource: "videoPrompt", directorInjected: Boolean(findDirectorBlockForShot(directorBlocks, shot.id)), referenceImageCount: references.reference_image_urls?.length || 0, referenceVideoCount: references.reference_video_urls?.length || videoAssets.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error && err.message.trim()
        ? err.message.trim()
        : typeof err === "string" && err.trim()
          ? err.trim()
          : getErrorMessage(err, { module: "video", fallbackMessage: "视频生成提交失败" });
      markStudioVideoProgress(shot.id, "error", getSeedreamVideoErrorMessage(errorMessage));
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
    const references = buildSeedanceVideoReferences({
      mode: selectedVideoRefs.length || selectedImageRefs.length > 1 ? "omni_reference" : selectedImageRefs.length === 1 ? "image_to_video" : "text_to_video",
      images: selectedImageRefs,
      videos: selectedVideoRefs,
    });
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: videoAspect,
        duration: normalizeVideoDuration(videoDuration, videoModel),
        resolution: normalizeVideoResolution(videoResolution, videoModel),
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: references.reference_image_urls,
        reference_image_roles: references.reference_image_roles,
        reference_video_urls: references.reference_video_urls,
        reference_image_role_mode: references.reference_image_role_mode,
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
    setStudioNodes((prev) => layoutStudioNodes(prev));
    toast.success("已按剧本 / 资产 / 分镜泳道重新排版");
  }, []);

  // ===== Studio 画布交互 =====
  const createGeneratorGroupNode = useCallback((nodeIds: string[], mode: "image" | "video") => {
    const shotIds = Array.from(new Set(nodeIds.filter((id) => storyboardShots.some((shot) => shot.id === id))));
    if (!shotIds.length) {
      toast.error("先选择或连入镜头节点，再创建生成器组");
      return;
    }
    const id = `generator-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group: GeneratorGroup = {
      id,
      title: mode === "image" ? `分镜图生成器组 · ${shotIds.length}镜` : `视频生成器组 · ${shotIds.length}镜`,
      mode,
      shotIds,
      modelLabel: mode === "image" ? "Seedream" : videoModel,
      aspectRatio: mode === "image" ? imageAspect : videoAspect,
      resolution: mode === "image" ? imageResolution : normalizeVideoResolution(videoResolution, videoModel),
      duration: mode === "video" ? normalizeVideoDuration(videoDuration, videoModel) : undefined,
      promptPreview: buildGeneratorGroupSummaryPrompt({
        mode,
        shotCount: shotIds.length,
        modelLabel: mode === "image" ? "Seedream" : videoModel,
        aspect: mode === "image" ? imageAspect : videoAspect,
        resolution: mode === "image" ? imageResolution : normalizeVideoResolution(videoResolution, videoModel),
        duration: mode === "video" ? normalizeVideoDuration(videoDuration, videoModel) : undefined,
      }),
      createdAt: new Date().toISOString(),
    };
    setGeneratorGroups((prev) => [group, ...prev]);
    setStudioSelectedNodeId(id);
    toast.success(`已创建${mode === "image" ? "分镜图" : "视频"}生成器组`);
  }, [imageAspect, imageResolution, storyboardShots, videoAspect, videoDuration, videoModel, videoResolution]);

  const addManualStudioConnection = useCallback((from: string, to: string, label: string, type: CanvasConnection["type"] = "binding") => {
    if (!from || !to || from === to) return;
    setStudioConnections((prev) => {
      if (prev.some((connection) => connection.from === from && connection.to === to)) return prev;
      return [
        ...prev,
        {
          id: `manual-${from}-${to}-${Date.now()}`,
          from,
          to,
          label,
          type,
        },
      ];
    });
  }, []);

  const handleCanvasConnectNodes = useCallback((from: string, to: string) => {
    const sourceShot = storyboardShots.find((shot) => shot.id === from);
    const targetShot = storyboardShots.find((shot) => shot.id === to);
    const sourceAsset = semanticAssets.find((asset) => asset.id === from);
    const targetAsset = semanticAssets.find((asset) => asset.id === to);
    const sourceGroup = generatorGroups.find((group) => group.id === from);
    const targetGroup = generatorGroups.find((group) => group.id === to);

    if (sourceAsset && targetShot) {
      addManualStudioConnection(from, to, "引用", "binding");
      setStoryboardShots((prev) => prev.map((shot) => shot.id === targetShot.id ? { ...shot, semanticAssetIds: Array.from(new Set([...shot.semanticAssetIds, sourceAsset.id])) } : shot));
      toast.success(`已绑定资产「${sourceAsset.name}」到镜头「${targetShot.title || targetShot.index}」`);
      return;
    }
    if (sourceShot && targetAsset) {
      addManualStudioConnection(from, to, "引用", "binding");
      setStoryboardShots((prev) => prev.map((shot) => shot.id === sourceShot.id ? { ...shot, semanticAssetIds: Array.from(new Set([...shot.semanticAssetIds, targetAsset.id])) } : shot));
      toast.success(`已绑定资产「${targetAsset.name}」到镜头「${sourceShot.title || sourceShot.index}」`);
      return;
    }
    if (sourceShot && targetGroup) {
      addManualStudioConnection(from, to, targetGroup.mode === "image" ? "生图" : "生视频", "generator");
      setGeneratorGroups((prev) => prev.map((group) => group.id === targetGroup.id ? { ...group, shotIds: Array.from(new Set([...group.shotIds, sourceShot.id])) } : group));
      toast.success("已把镜头加入生成器组");
      return;
    }
    if (sourceGroup && targetShot) {
      addManualStudioConnection(from, to, sourceGroup.mode === "image" ? "生图" : "生视频", "generator");
      setGeneratorGroups((prev) => prev.map((group) => group.id === sourceGroup.id ? { ...group, shotIds: Array.from(new Set([...group.shotIds, targetShot.id])) } : group));
      toast.success("已把镜头加入生成器组");
      return;
    }
    if (sourceShot && targetShot) {
      addManualStudioConnection(from, to, "顺序", "sequence");
      const sourceIndex = sourceShot.index;
      const targetIndex = targetShot.index;
      setStoryboardShots((prev) => prev.map((shot) => {
        if (shot.id === from) return { ...shot, index: Math.min(sourceIndex, targetIndex) };
        if (shot.id === to) return { ...shot, index: Math.max(sourceIndex, targetIndex) };
        return shot;
      }).sort((a, b) => a.index - b.index).map((shot, index) => ({ ...shot, index: index + 1 })));
      toast.success("已建立镜头顺序关系");
      return;
    }
    addManualStudioConnection(from, to, "引用", "binding");
    toast.message("该连线已记录为画布上下文，后续可扩展为更多自动引用");
  }, [addManualStudioConnection, generatorGroups, semanticAssets, storyboardShots]);

  const handleBindAssetMention = useCallback((nodeId: string, assetId: string) => {
    const asset = semanticAssets.find((item) => item.id === assetId);
    if (!asset) return;
    const node = studioNodes.find((item) => item.id === nodeId);
    const sourceShotId = typeof node?.data?.sourceShotId === "string"
      ? node.data.sourceShotId
      : nodeId.startsWith("video-node-")
        ? nodeId.replace("video-node-", "")
        : nodeId.startsWith("image-node-")
          ? nodeId.replace("image-node-", "")
          : nodeId;
    const shot = storyboardShots.find((item) => item.id === sourceShotId);
    if (!shot) {
      toast.message("当前节点不是镜头链路节点，已只插入 @资产名");
      return;
    }
    setStoryboardShots((prev) => prev.map((item) => item.id === sourceShotId
      ? { ...item, semanticAssetIds: Array.from(new Set([...item.semanticAssetIds, assetId])) }
      : item
    ));
    addManualStudioConnection(assetId, shot.id, "引用", "binding");
    toast.success(`已绑定资产「${asset.name}」到镜头「${shot.title || shot.index}」`);
  }, [addManualStudioConnection, semanticAssets, storyboardShots, studioNodes]);

  const handleStudioAddNode = useCallback((type: CanvasNode["type"], x: number, y: number, sourceNodeId?: string, sourceSide: "left" | "right" = "right") => {
    const id = `studio-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (type === "generator") {
      const selectedShotIds = studioSelectedNodeId && storyboardShots.some((shot) => shot.id === studioSelectedNodeId) ? [studioSelectedNodeId] : storyboardShots.slice(0, Math.max(1, Math.min(batchLimit, storyboardShots.length))).map((shot) => shot.id);
      createGeneratorGroupNode(selectedShotIds, "image");
      return;
    }
    const sourceNode = sourceNodeId ? studioNodes.find((node) => node.id === sourceNodeId) : undefined;
    const sourceShotId = sourceNodeId && storyboardShots.some((shot) => shot.id === sourceNodeId) ? sourceNodeId : undefined;
    const sourceShot = sourceShotId ? storyboardShots.find((shot) => shot.id === sourceShotId) : undefined;
    const sourceAssetId = sourceNode?.type === "assets" ? String(sourceNode.data?.linkedAssetId || sourceNode.id || "") : "";
    const sourceSemanticAsset = sourceAssetId ? semanticAssets.find((asset) => asset.id === sourceAssetId) : undefined;
    const isAssetImageNode = sourceNode?.type === "assets" && type === "image";
    const isImageToVideoNode = sourceNode?.type === "image" && type === "video";
    const assetImageTitle = isAssetImageNode
      ? `${sourceSemanticAsset?.name || sourceNode?.title || "资产"}${sourceSemanticAsset?.kind === "character" ? "角色图" : "资产图"}`
      : "";
    const newNode: CanvasNode = {
      id,
      type,
      title: type === "script" ? "新剧本" : type === "assets" ? "未命名资产" : type === "shot" ? "新镜头" : isAssetImageNode ? assetImageTitle : type === "image" ? "新分镜图" : type === "video" ? "新视频" : type === "director" ? "3D导演台" : "新节点",
      x,
      y,
      width: type === "script" || type === "director" ? 420 : 360,
      height: type === "script" || type === "director" ? 300 : type === "assets" ? 440 : 420,
      status: isAssetImageNode ? "draft" : "empty",
      data: isAssetImageNode ? {
        sourceAssetNodeId: sourceNode?.id,
        linkedAssetId: sourceAssetId,
        kind: sourceSemanticAsset?.kind || sourceNode?.data?.kind || sourceNode?.data?.category || "character",
        category: sourceSemanticAsset?.kind || sourceNode?.data?.category || "character",
        imagePrompt: "",
        summary: sourceSemanticAsset?.summary || sourceNode?.data?.summary || sourceNode?.data?.content || "",
        content: "",
        referenceImageUrl: sourceSemanticAsset?.imageUrl || String(sourceNode?.data?.imageUrl || sourceNode?.data?.image || sourceNode?.data?.thumbnail || ""),
        referenceAssetId: sourceSemanticAsset?.imageAssetId || sourceNode?.data?.imageAssetId,
        referenceAssetNodeId: sourceNode?.id,
      } : isImageToVideoNode ? {
        sourceImageNodeId: sourceNode?.id,
        videoPrompt: String(sourceNode?.data?.videoPrompt || sourceNode?.data?.imagePrompt || sourceNode?.data?.scene || ""),
        imagePrompt: String(sourceNode?.data?.imagePrompt || sourceNode?.data?.scene || ""),
        scene: String(sourceNode?.data?.scene || ""),
        firstFrameUrl: String(sourceNode?.data?.imageUrl || sourceNode?.data?.url || ""),
        firstFrameAssetId: typeof sourceNode?.data?.imageAssetId === "string" ? sourceNode.data.imageAssetId : undefined,
      } : sourceShotId && (type === "video" || type === "image") ? {
        sourceShotId,
        ...(type === "video" ? {
          videoPrompt: sourceShot?.videoPrompt || sourceShot?.imagePrompt || "",
          imagePrompt: sourceShot?.imagePrompt || "",
          scene: sourceShot?.scene || "",
        } : {
          imagePrompt: sourceShot?.imagePrompt || "",
          scene: sourceShot?.scene || "",
        }),
      } : {},
    };
    setStudioNodes((prev) => [...prev, newNode]);
    if (sourceNodeId) {
      const from = sourceSide === "left" ? id : sourceNodeId;
      const to = sourceSide === "left" ? sourceNodeId : id;
      const label = sourceNode?.type === "assets" && type === "image" ? "派生图片" : sourceNode?.type === "assets" || type === "assets" ? "引用" : type === "image" ? "生成分镜" : type === "video" ? "生成视频" : "引用";
      const edgeType: CanvasConnection["type"] = sourceNode?.type === "assets" || type === "assets" ? "binding" : "sequence";
      addManualStudioConnection(from, to, label, edgeType);
    }
    setStudioSelectedNodeId(id);

    // 同步到对应工作流状态
    if (type === "shot") {
      const newShot = createShot(storyboardShots.length + 1, { id: newNode.id });
      setStoryboardShots((prev) => [...prev, newShot]);
      setActiveShotId(id);
      setWorkflowMode("storyboardVideo");
      setWorkflowView("step");
    } else if (type === "assets") {
      const newAsset: SemanticAsset = {
        id,
        kind: "character",
        name: "未命名资产",
        summary: "",
        lockPrompt: "",
        negativePrompt: "",
        linkedAssetIds: [],
        createdAt: new Date().toISOString(),
      };
      setSemanticAssets((prev) => [...prev, newAsset]);
      setActiveSemanticAssetId(id);
      setWorkflowMode("assets");
      setWorkflowView("step");
    } else if (type === "script") {
      setWorkflowMode("script");
      setWorkflowView("step");
    } else if (type === "director") {
      setWorkflowMode("storyboardVideo");
      setWorkflowView("step");
    }
  }, [addManualStudioConnection, batchLimit, createGeneratorGroupNode, semanticAssets, storyboardShots, studioNodes, studioSelectedNodeId]);

  const handleDropAssetToCanvas = useCallback((asset: CanvasAssetDropPayload, x: number, y: number) => {
    const kind = (["character", "scene", "prop", "style"].includes(String(asset.kind)) ? asset.kind : "character") as SemanticAssetKind;
    const title = asset.name || "未命名资产";
    const normalizedTitle = title.replace(/-资产图$|资产图$/g, "").trim();
    const linkedSemanticAsset = asset.source === "semantic"
      ? semanticAssets.find((item) => item.id === asset.id)
      : semanticAssets.find((item) => item.imageAssetId === asset.id
        || item.linkedAssetIds.includes(asset.id)
        || normalizeSemanticAssetKey(item) === normalizeSemanticAssetKey({ kind, name: normalizedTitle }));
    const linkedAssetId = linkedSemanticAsset?.id;
    const existingNode = studioNodes.find((node) => node.type === "assets" && (
      (linkedAssetId && node.data?.linkedAssetId === linkedAssetId)
      || (!linkedAssetId && node.data?.linkedMediaAssetId === asset.id)
    ));
    if (existingNode) {
      setStudioNodes((prev) => prev.map((node) => node.id === existingNode.id ? { ...node, x, y } : node));
      setStudioSelectedNodeId(existingNode.id);
      if (linkedAssetId) setActiveSemanticAssetId(linkedAssetId);
      setWorkflowMode("assets");
      setWorkflowView("step");
      toast.success(`已把「${asset.name || existingNode.title}」放到画布`);
      return;
    }

    const id = `studio-assets-${asset.id}-${Date.now()}`;
    const nodeSummary = linkedSemanticAsset?.summary || asset.summary || "";
    const nodeLockPrompt = linkedSemanticAsset?.lockPrompt || asset.lockPrompt || asset.summary || "";
    const nodeImage = linkedSemanticAsset?.imageUrl || asset.image || "";
    const newNode: CanvasNode = {
      id,
      type: "assets",
      title: linkedSemanticAsset?.name || normalizedTitle || title,
      x,
      y,
      width: 360,
      height: 440,
      status: nodeImage || nodeSummary ? "draft" : "empty",
      data: {
        kind: linkedSemanticAsset?.kind || kind,
        category: linkedSemanticAsset?.kind || kind,
        summary: nodeSummary,
        content: nodeSummary,
        lockPrompt: nodeLockPrompt,
        thumbnail: nodeImage,
        imageUrl: nodeImage,
        image_url: nodeImage,
        url: nodeImage,
        linkedAssetId,
        linkedMediaAssetId: asset.source === "library" ? asset.id : undefined,
        asset: linkedSemanticAsset,
        source: asset.source || "library",
      },
    };
    setStudioNodes((prev) => [...prev, newNode]);
    setStudioSelectedNodeId(id);
    if (linkedAssetId) setActiveSemanticAssetId(linkedAssetId);
    setWorkflowMode("assets");
    setWorkflowView("step");
    toast.success(`已从资产库创建「${newNode.title}」节点`);
  }, [semanticAssets, studioNodes]);

  const handleStudioNodeMove = useCallback((id: string, x: number, y: number) => {
    setStudioNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const handleStudioNodeDelete = useCallback((id: string) => {
    setStudioNodes((prev) => prev.filter((n) => n.id !== id));
    setStudioConnections((prev) => prev.filter((connection) => connection.from !== id && connection.to !== id));
    if (id === "script-main") {
      setWorkflowScript("");
      setWorkflowStoryboardImage("");
      setWorkflowStoryboardVideo("");
    }
    setStoryboardShots((prev) => prev.filter((s) => s.id !== id));
    setSemanticAssets((prev) => prev.filter((a) => a.id !== id));
    setDirectorBlocks((prev) => id === "director-main" ? [] : prev.filter((block) => block.id !== id && block.shotId !== id));
    setGeneratorGroups((prev) => prev.filter((group) => group.id !== id).map((group) => ({ ...group, shotIds: group.shotIds.filter((shotId) => shotId !== id) })));
    if (activeShotId === id) setActiveShotId(undefined);
    if (activeSemanticAssetId === id) setActiveSemanticAssetId(undefined);
    if (studioSelectedNodeId === id) setStudioSelectedNodeId(null);
  }, [activeShotId, activeSemanticAssetId, studioSelectedNodeId]);

  const handleDeleteSemanticAsset = useCallback((assetId: string) => {
    const asset = semanticAssets.find((item) => item.id === assetId);
    const ok = typeof window === "undefined" ? true : window.confirm(`删除资产「${asset?.name || "未命名资产"}」？\n\n会同时移除画布中引用它的资产节点和镜头/导演台绑定。`);
    if (!ok) return;

    const linkedCanvasNodeIds = studioNodes
      .filter((node) => node.id === assetId || node.data?.linkedAssetId === assetId)
      .map((node) => node.id);
    const linkedCanvasNodeIdSet = new Set(linkedCanvasNodeIds);

    setSemanticAssets((prev) => prev.filter((item) => item.id !== assetId));
    setStoryboardShots((prev) => prev.map((shot) => ({
      ...shot,
      semanticAssetIds: shot.semanticAssetIds?.filter((id) => id !== assetId),
    })));
    setGenerationJobs((prev) => prev.filter((job) => job.semanticAssetId !== assetId));
    setDirectorBlocks((prev) => prev.map((block) => ({
      ...block,
      sceneBlock: {
        ...block.sceneBlock,
        sceneAssetId: block.sceneBlock.sceneAssetId === assetId ? undefined : block.sceneBlock.sceneAssetId,
      },
      characters: block.characters.filter((character) => character.semanticAssetId !== assetId),
    })));
    setStudioNodes((prev) => prev.filter((node) => !linkedCanvasNodeIdSet.has(node.id)));
    setStudioConnections((prev) => prev.filter((connection) => !linkedCanvasNodeIdSet.has(connection.from) && !linkedCanvasNodeIdSet.has(connection.to)));
    if (activeSemanticAssetId === assetId) setActiveSemanticAssetId(undefined);
    if (studioSelectedNodeId && linkedCanvasNodeIdSet.has(studioSelectedNodeId)) setStudioSelectedNodeId(null);
    toast.success("已删除资产");
  }, [activeSemanticAssetId, semanticAssets, studioNodes, studioSelectedNodeId]);

  const handleUpdateNodeContent = useCallback((nodeId: string, updates: { title?: string; body?: string }) => {
    if (updates.title !== undefined) {
      setStudioNodes((prev) => prev.map((node) => node.id === nodeId ? { ...node, title: updates.title || "未命名节点" } : node));
      setStoryboardShots((prev) => prev.map((shot) => shot.id === nodeId ? { ...shot, title: updates.title || shot.title } : shot));
      const currentNode = studioNodes.find((node) => node.id === nodeId);
      const linkedAssetId = typeof currentNode?.data?.linkedAssetId === "string" ? currentNode.data.linkedAssetId : nodeId;
      setSemanticAssets((prev) => prev.map((asset) => asset.id === linkedAssetId ? { ...asset, name: updates.title || asset.name } : asset));
      setGeneratorGroups((prev) => prev.map((group) => group.id === nodeId ? { ...group, title: updates.title || group.title } : group));
    }

    if (updates.body !== undefined) {
      const body = updates.body;
      if (nodeId === "script-main") {
        setWorkflowScript(body);
        return;
      }
      const currentNode = studioNodes.find((node) => node.id === nodeId);
      if (currentNode?.type === "assets") {
        const linkedAssetId = typeof currentNode.data?.linkedAssetId === "string" ? currentNode.data.linkedAssetId : nodeId;
        setStudioNodes((prev) => prev.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, summary: body, content: body } } : node));
        setSemanticAssets((prev) => prev.map((asset) => asset.id === linkedAssetId ? { ...asset, summary: body } : asset));
        return;
      }
      const targetShotId = typeof currentNode?.data?.sourceShotId === "string"
        ? currentNode.data.sourceShotId
        : nodeId.startsWith("video-node-") ? nodeId.replace("video-node-", "") : nodeId;
      setStoryboardShots((prev) => prev.map((shot) => {
        if (shot.id !== targetShotId) return shot;
        if (currentNode?.type === "video" || shot.videoAssetIds?.length || shot.videoPrompt) return { ...shot, videoPrompt: body };
        return { ...shot, imagePrompt: body, scene: shot.scene || body.slice(0, 60) };
      }));
      setStudioNodes((prev) => prev.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, [node.type === "video" ? "videoPrompt" : "imagePrompt"]: body } } : node));
      setSemanticAssets((prev) => prev.map((asset) => asset.id === nodeId ? { ...asset, lockPrompt: body, summary: asset.summary || body.slice(0, 80) } : asset));
      setGeneratorGroups((prev) => prev.map((group) => group.id === nodeId ? { ...group, promptPreview: body } : group));
    }
  }, [studioNodes]);

  const handleComposerSettingsChange = useCallback((nodeId: string, updates: Partial<{
    imageAspect: string;
    imageResolution: string;
    assetPreset: "character" | "characterTurnaround" | "asset";
    videoModel: string;
    videoAspect: string;
    videoResolution: string;
    videoDuration: number;
    videoAudio: boolean;
  }>) => {
    if (updates.imageAspect !== undefined) setImageAspect(updates.imageAspect);
    if (updates.imageResolution !== undefined) setImageResolution(updates.imageResolution);
    if (updates.assetPreset !== undefined) setAssetPreset(updates.assetPreset);
    const nextVideoModel = updates.videoModel || videoModel;
    if (updates.videoModel !== undefined) setVideoModel(updates.videoModel);
    if (updates.videoAspect !== undefined) setVideoAspect(updates.videoAspect);
    const normalizedVideoResolution = updates.videoResolution !== undefined || updates.videoModel !== undefined
      ? normalizeVideoResolution(updates.videoResolution || videoResolution, nextVideoModel)
      : undefined;
    if (normalizedVideoResolution !== undefined) setVideoResolution(normalizedVideoResolution);
    const normalizedVideoDuration = updates.videoDuration !== undefined
      ? normalizeVideoDuration(updates.videoDuration, updates.videoModel || videoModel)
      : updates.videoModel !== undefined
        ? normalizeVideoDuration(videoDuration, updates.videoModel)
        : undefined;
    if (normalizedVideoDuration !== undefined) setVideoDuration(normalizedVideoDuration);
    if (updates.videoAudio !== undefined) setVideoAudio(updates.videoAudio);

    const currentNode = studioNodes.find((node) => node.id === nodeId);
    const targetShotId = typeof currentNode?.data?.sourceShotId === "string"
      ? currentNode.data.sourceShotId
      : nodeId.startsWith("image-node-") ? nodeId.replace("image-node-", "") : nodeId.startsWith("video-node-") ? nodeId.replace("video-node-", "") : nodeId;
    setStoryboardShots((prev) => prev.map((shot) => {
      if (shot.id !== targetShotId) return shot;
      const patch: Partial<StoryboardShot> = {};
      if (updates.imageAspect !== undefined) patch.aspectRatio = updates.imageAspect;
      if (updates.videoAspect !== undefined) patch.aspectRatio = updates.videoAspect;
      if (normalizedVideoDuration !== undefined) patch.duration = normalizedVideoDuration;
      return Object.keys(patch).length ? { ...shot, ...patch } : shot;
    }));

    setGeneratorGroups((prev) => prev.map((group) => group.id === nodeId ? {
      ...group,
      modelLabel: updates.videoModel || group.modelLabel,
      aspectRatio: updates.videoAspect || updates.imageAspect || group.aspectRatio,
      resolution: normalizedVideoResolution || updates.imageResolution || group.resolution,
      duration: normalizedVideoDuration ?? group.duration,
    } : group));
  }, [studioNodes]);

  const handleComposerGenerate = useCallback(async (nodeId: string) => {
    const group = generatorGroups.find((item) => item.id === nodeId);
    if (group) {
      const queue = storyboardShots.filter((shot) => group.shotIds.includes(shot.id));
      if (!queue.length) return toast.error("生成器组里没有镜头，先把镜头连入生成器组");
      if (group.mode === "video") await batchGenerateVideosForShots(queue);
      else await batchGenerateImagesForShots(queue);
      return;
    }

    const node = studioNodes.find((item) => item.id === nodeId);
    if (node?.type === "assets") {
      const linkedAssetId = typeof node.data?.linkedAssetId === "string" ? node.data.linkedAssetId : nodeId;
      const asset = semanticAssets.find((item) => item.id === linkedAssetId);
      if (asset) {
        await generateSemanticAssetImage(asset, asset.kind === "character" && assetPreset === "characterTurnaround" ? "character-turnaround" : "default");
        return;
      }
      toast.message("当前资产节点没有关联到资产库记录");
      return;
    }
    if (node?.type === "image" && !node.data?.sourceShotId) {
      await generateCanvasImageNode(node);
      return;
    }
    if (node?.type === "video" && !node.data?.sourceShotId) {
      await generateCanvasVideoNode(node);
      return;
    }
    const sourceShotId = typeof node?.data?.sourceShotId === "string"
      ? node.data.sourceShotId
      : nodeId.startsWith("image-node-") ? nodeId.replace("image-node-", "") : nodeId.startsWith("video-node-") ? nodeId.replace("video-node-", "") : nodeId;
    const shot = storyboardShots.find((item) => item.id === sourceShotId);
    if (shot) {
      if (node?.type === "video") {
        await generateShotVideo(shot);
      } else if (node?.type === "image" || node?.type === "shot") {
        await generateShotImage(shot);
      } else if (shot.videoPrompt && !shot.imagePrompt) {
        await generateShotVideo(shot);
      } else {
        await generateShotImage(shot);
      }
      return;
    }

    const asset = semanticAssets.find((item) => item.id === nodeId);
    if (asset) {
      await generateSemanticAssetImage(asset, asset.kind === "character" && assetPreset === "characterTurnaround" ? "character-turnaround" : "default");
      return;
    }

    if (nodeId.startsWith("asset-")) {
      await generateNodeAssetImage(nodeId);
      return;
    }

    toast.message("当前节点没有可直接生成的任务");
  }, [batchGenerateImagesForShots, batchGenerateVideosForShots, generateCanvasImageNode, generateCanvasVideoNode, generateNodeAssetImage, generateSemanticAssetImage, generateShotImage, generateShotVideo, generatorGroups, semanticAssets, storyboardShots, studioNodes]);

  const handleStudioNodeDoubleClick = useCallback((node: CanvasNode) => {
    setStudioSelectedNodeId(node.id);
    if (node.type === "script") {
      setWorkflowMode("script");
      setWorkflowView("step");
      setActiveShotId(undefined);
      setActiveSemanticAssetId(undefined);
    } else if (node.type === "assets") {
      const linkedAssetId = typeof node.data?.linkedAssetId === "string" ? node.data.linkedAssetId : node.id;
      const asset = semanticAssets.find((a) => a.id === linkedAssetId);
      setActiveSemanticAssetId(asset?.id);
      setWorkflowMode("assets");
      setWorkflowView("step");
      setActiveShotId(undefined);
    } else if (node.type === "shot" || node.type === "image" || node.type === "video") {
      const sourceShotId = node.id.startsWith("image-node-") ? node.id.replace("image-node-", "") : node.id.startsWith("video-node-") ? node.id.replace("video-node-", "") : node.id;
      const shot = storyboardShots.find((s) => s.id === sourceShotId);
      setActiveShotId(shot?.id);
      setWorkflowMode("storyboardVideo");
      setWorkflowView("step");
      setActiveSemanticAssetId(undefined);
    } else if (node.type === "generator") {
      const group = generatorGroups.find((item) => item.id === node.id);
      setWorkflowMode(group?.mode === "video" ? "storyboardVideo" : "storyboardImage");
      setWorkflowView("step");
      setActiveShotId(undefined);
      setActiveSemanticAssetId(undefined);
    } else if (node.type === "director") {
      setWorkflowMode("storyboardVideo");
      setWorkflowView("step");
      setActiveShotId(undefined);
      setActiveSemanticAssetId(undefined);
    }
  }, [generatorGroups, semanticAssets, storyboardShots]);

  // ===== 右侧面板内容 =====
  const rightPanelContent = (() => {
    if (workflowView === "videoSegments") {
      return <VideoSegmentGenerator
        shots={storyboardShots}
        assets={assets}
        onGenerateSegment={async (segment) => {
          for (let i = 0; i < segment.shots.length; i++) {
            const shot = segment.shots[i];
            const prevShot = i > 0 ? segment.shots[i - 1] : undefined;
            if (prevShot?.lastFrameAssetId) {
              updateShot(shot.id, {
                firstFrameAssetId: prevShot.lastFrameAssetId,
                referenceAssetIds: Array.from(new Set([...(shot.referenceAssetIds || []), prevShot.lastFrameAssetId])),
              });
            }
            await generateShotVideo(shot, "batch");
          }
          toast.success(`段落 ${segment.index} 视频生成已提交`);
        }}
      />;
    }

    if (selectedGeneratorGroup) {
      const kind = selectedGeneratorGroup.mode === "video" ? "videos" : "images";
      const missingPromptCount = selectedGeneratorQueue.filter((shot) =>
        selectedGeneratorGroup.mode === "video"
          ? !(shot.videoPrompt || shot.imagePrompt).trim()
          : !(shot.imagePrompt || shot.scene || shot.title).trim(),
      ).length;
      return (
        <div className="space-y-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{selectedGeneratorGroup.title}</h3>
              <p className="mt-1 text-[11px] text-text-tertiary">
                {selectedGeneratorGroup.mode === "video" ? "Seedance 视频批量队列" : "Seedream 分镜图批量队列"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStudioSelectedNodeId(null)}
              className="rounded p-1 text-text-tertiary hover:bg-surface-card hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <BatchPreflightPanel
            kind={kind}
            queue={selectedGeneratorQueue}
            assets={assets}
            directorBlocks={directorBlocks}
          />

          <div className="rounded-2xl border border-surface-border bg-surface-card/70 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-semibold text-text-primary">生成参数</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-text-tertiary">{selectedGeneratorQueue.length} 镜</span>
            </div>
            <div className="space-y-1 text-[11px] leading-relaxed text-text-secondary">
              <div>模型：{selectedGeneratorGroup.modelLabel || (selectedGeneratorGroup.mode === "video" ? videoModel : "Seedream")}</div>
              <div>比例：{selectedGeneratorGroup.aspectRatio || (selectedGeneratorGroup.mode === "video" ? videoAspect : imageAspect)}</div>
              <div>分辨率：{selectedGeneratorGroup.resolution || (selectedGeneratorGroup.mode === "video" ? videoResolution : imageResolution)}</div>
              {selectedGeneratorGroup.mode === "video" && <div>时长：{selectedGeneratorGroup.duration || videoDuration}s</div>}
            </div>
          </div>

          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {selectedGeneratorQueue.map((shot) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => {
                  setActiveShotId(shot.id);
                  setWorkflowMode(selectedGeneratorGroup.mode === "video" ? "storyboardVideo" : "storyboardImage");
                }}
                className="w-full rounded-xl border border-surface-border bg-surface-base p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-text-primary">{shot.index}. {shot.title || shot.scene || "未命名镜头"}</span>
                  <span className="shrink-0 rounded-full bg-surface-card px-2 py-0.5 text-[10px] text-text-tertiary">{shot.duration}s</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-tertiary">
                  {selectedGeneratorGroup.mode === "video" ? (shot.videoPrompt || shot.imagePrompt || "缺视频提示词") : (shot.imagePrompt || shot.scene || "缺分镜图提示词")}
                </p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setGeneratorGroups((prev) => prev.map((group) => group.id === selectedGeneratorGroup.id ? { ...group, shotIds: storyboardShots.map((shot) => shot.id) } : group))}
              className="rounded-lg border border-surface-border py-2 text-[11px] font-medium text-text-secondary hover:bg-surface-card"
            >
              全部镜头入组
            </button>
            <button
              type="button"
              onClick={() => setGeneratorGroups((prev) => prev.filter((group) => group.id !== selectedGeneratorGroup.id))}
              className="rounded-lg border border-red-100 py-2 text-[11px] font-medium text-red-500 hover:bg-red-50"
            >
              删除生成器组
            </button>
          </div>

          <button
            type="button"
            disabled={Boolean(batchGenerating) || !selectedGeneratorQueue.length || missingPromptCount > 0}
            onClick={() => selectedGeneratorGroup.mode === "video" ? batchGenerateVideosForShots(selectedGeneratorQueue) : batchGenerateImagesForShots(selectedGeneratorQueue)}
            className="flex w-full items-center justify-center gap-1 rounded-xl bg-slate-950 py-2.5 text-[12px] font-semibold text-white hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {batchGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {missingPromptCount > 0 ? `先补齐 ${missingPromptCount} 个 Prompt` : selectedGeneratorGroup.mode === "video" ? "提交本组视频生成" : "提交本组分镜图生成"}
          </button>

          {batchGenerating && (
            <button
              type="button"
              onClick={pauseBatchGeneration}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
            >
              暂停批量提交
            </button>
          )}
        </div>
      );
    }

    if (workflowView === "step" && activeShotId && !(workflowMode === "storyboardVideo" || workflowMode === "storyboardImage")) {
      const shot = storyboardShots.find((s) => s.id === activeShotId);
      return (
        <div className="space-y-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">{shot?.title || "未命名镜头"}</h3>
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
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">标题</label>
              <input
                type="text"
                value={shot?.title || ""}
                onChange={(e) => updateShot(activeShotId, { title: e.target.value })}
                className="w-full rounded-lg border border-surface-border bg-surface-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">场景</label>
              <input
                type="text"
                value={shot?.scene || ""}
                onChange={(e) => updateShot(activeShotId, { scene: e.target.value })}
                className="w-full rounded-lg border border-surface-border bg-surface-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">分镜图提示词</label>
              <textarea
                value={shot?.imagePrompt || ""}
                onChange={(e) => updateShot(activeShotId, { imagePrompt: e.target.value })}
                placeholder="输入分镜图提示词..."
                className="h-24 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => shot && generateShotImage(shot)}
                disabled={isGenerating}
                className="flex w-full items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                生成分镜图
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">视频提示词</label>
              <textarea
                value={shot?.videoPrompt || ""}
                onChange={(e) => updateShot(activeShotId, { videoPrompt: e.target.value })}
                placeholder="输入视频提示词..."
                className="h-24 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => shot && generateShotVideo(shot)}
                disabled={isGenerating}
                className="flex w-full items-center justify-center gap-1 rounded-lg bg-rose-50 py-2 text-[11px] font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                生成视频
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-text-tertiary">导演台</label>
                <button
                  type="button"
                  onClick={() => {
                    if (shot) ensureDirectorBlockForShot(shot);
                    setShowDirectorPanel(true);
                  }}
                  className="text-[10px] text-brand hover:text-brand-hover"
                >
                  {findDirectorBlockForShot(directorBlocks, activeShotId) ? "已启用" : "启用"}
                </button>
              </div>
              {findDirectorBlockForShot(directorBlocks, activeShotId) && (
                <div className="rounded-lg bg-surface-card p-2 text-[10px] text-text-secondary">导演台已启用，空间约束已注入生成流程</div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
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
      );
    }

    if (workflowView === "step" && workflowMode === "script") {
      return (
        <div className="space-y-3">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">剧本编辑器</h3>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">本集剧情/小说片段</label>
              <textarea
                value={scriptSourceExcerpt}
                onChange={(e) => setScriptSourceExcerpt(e.target.value)}
                placeholder="粘贴本集剧情、小说片段或简短创意..."
                className="h-24 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">改编要求</label>
              <input
                type="text"
                value={scriptAdaptationInstruction}
                onChange={(e) => setScriptAdaptationInstruction(e.target.value)}
                placeholder="例：第一幕要强钩子，对白更口语化..."
                className="w-full rounded-lg border border-surface-border bg-surface-base px-2.5 py-1.5 text-xs text-text-secondary outline-none focus:border-brand"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => generateWorkflow("novel")}
                disabled={Boolean(workflowGenerating)}
                className="flex items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                {workflowGenerating === "novel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                一键写小说
              </button>
              <button
                type="button"
                onClick={() => generateWorkflow("script")}
                disabled={Boolean(workflowGenerating)}
                className="flex items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                {workflowGenerating === "script" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                一键生成剧本
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">修改意见</label>
              <textarea
                value={scriptRevisionInstruction}
                onChange={(e) => setScriptRevisionInstruction(e.target.value)}
                placeholder="输入要如何修改剧本..."
                className="h-20 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => reviseScriptWithInstruction()}
                disabled={scriptRevising}
                className="flex w-full items-center justify-center gap-1 rounded-lg bg-surface-card py-2 text-[11px] font-medium text-text-primary hover:bg-surface-border disabled:opacity-50"
              >
                {scriptRevising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                一键改剧本
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-tertiary">剧本正文</label>
              <textarea
                value={workflowScript}
                onChange={(e) => setWorkflowScript(e.target.value)}
                placeholder="剧本内容..."
                className="h-48 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>
      );
    }

    if (workflowView === "step" && workflowMode === "assets") {
      return (
        <div className="space-y-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">资产编辑器</h3>
            <button
              type="button"
              onClick={() => generateWorkflow("assets")}
              disabled={Boolean(workflowGenerating)}
              className="flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
            >
              {workflowGenerating === "assets" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              提取资产候选
            </button>
          </div>
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
            资产生成不会直接生成图片。系统会先从剧本提取角色/场景/道具/风格候选，用户确认或修改后再录入资产库；资产卡内再手动生成图片。
          </div>
          {assetCandidates.length > 0 && (
            <button
              type="button"
              onClick={() => setAssetPreprocessOpen(true)}
              className="flex w-full items-center justify-between rounded-xl border border-brand/20 bg-brand/5 p-3 text-left text-[11px] text-text-secondary hover:bg-brand/10"
            >
              <span>
                已提取 <span className="font-semibold text-brand">{assetCandidates.length}</span> 个待确认资产候选，请在独立预处理弹层中勾选、修改后再录入资产库。
              </span>
              <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">打开预处理</span>
            </button>
          )}
          <div className="space-y-3">
            {semanticAssets.length === 0 && (
              <div className="rounded-lg border border-dashed border-surface-border p-4 text-center text-xs text-text-tertiary">
                暂无资产，点击“提取资产候选”预处理后录入，或用画布 + 号手动添加
              </div>
            )}
            {semanticAssets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => setActiveSemanticAssetId(asset.id)}
                className={cn(
                  "cursor-pointer rounded-lg border p-3 transition-colors",
                  activeSemanticAssetId === asset.id
                    ? "border-brand/40 bg-brand/5"
                    : "border-surface-border bg-surface-base hover:bg-surface-card"
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-surface-card px-1.5 py-0.5 text-[10px] text-text-tertiary">
                      {asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : asset.kind === "prop" ? "道具" : "风格"}
                    </span>
                    <span className="text-xs font-medium text-text-primary">{asset.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      generateSemanticAssetImage(asset);
                    }}
                    disabled={assetImageGeneratingId === asset.id}
                    className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[10px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
                  >
                    {assetImageGeneratingId === asset.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                    生成图
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-semibold text-text-tertiary">资产描述</label>
                  <textarea
                    value={asset.summary}
                    onChange={(e) => updateSemanticAsset(asset.id, { summary: e.target.value })}
                    placeholder="人物外貌定妆 / 场景结构 / 道具形制 / 风格要点..."
                    className="h-20 w-full rounded border border-surface-border bg-surface-elevated p-1.5 text-[10px] leading-relaxed text-text-secondary outline-none focus:border-brand"
                  />
                  <label className="block text-[10px] font-semibold text-text-tertiary">生图锁定词</label>
                  <textarea
                    value={asset.lockPrompt}
                    onChange={(e) => updateSemanticAsset(asset.id, { lockPrompt: e.target.value })}
                    placeholder="lock_prompt..."
                    className="h-16 w-full rounded border border-surface-border bg-surface-elevated p-1.5 text-[10px] leading-relaxed text-text-secondary outline-none focus:border-brand"
                  />
                  {activeSemanticAssetId === asset.id && (
                    <div className="space-y-2 rounded-lg border border-brand/15 bg-brand/5 p-2" onClick={(event) => event.stopPropagation()}>
                      <textarea
                        value={assetRegenerateInstruction}
                        onChange={(event) => setAssetRegenerateInstruction(event.target.value)}
                        placeholder="告诉 AI 怎么改这张资产：例如“只保留外貌定妆，去掉剧情作用，强化黑色旧蓑衣和旧刀缺口”"
                        className="h-16 w-full resize-none rounded border border-surface-border bg-surface-base p-2 text-[10px] leading-relaxed text-text-secondary outline-none focus:border-brand"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => regenerateSemanticAsset(asset)}
                          disabled={assetRegeneratingId === asset.id}
                          className="flex items-center justify-center gap-1 rounded-md bg-brand px-2 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50"
                        >
                          {assetRegeneratingId === asset.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          AI改写并覆盖
                        </button>
                        <button
                          type="button"
                          onClick={() => chatAboutAsset(asset)}
                          disabled={assetChatting || !assetChatInput.trim()}
                          className="flex items-center justify-center gap-1 rounded-md border border-surface-border bg-surface-card px-2 py-1.5 text-[10px] font-semibold text-text-primary disabled:opacity-50"
                        >
                          {assetChatting ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                          聊一下
                        </button>
                      </div>
                      <input
                        value={assetChatInput}
                        onChange={(event) => setAssetChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            chatAboutAsset(asset);
                          }
                        }}
                        placeholder="问这张资产怎么改：如“这个人物描述为什么不适合生图？”"
                        className="h-8 w-full rounded border border-surface-border bg-surface-base px-2 text-[10px] text-text-secondary outline-none focus:border-brand"
                      />
                      {assetChatMessages.length > 0 && (
                        <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-surface-border bg-surface-base p-2 text-[10px] leading-relaxed text-text-secondary">
                          {assetChatMessages.slice(-4).map((message) => (
                            <div key={message.id} className={message.role === "user" ? "text-text-tertiary" : "text-text-primary"}>
                              <span className="font-semibold">{message.role === "user" ? "你：" : "AI："}</span>{message.content || "..."}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (workflowView === "step" && (workflowMode === "storyboardVideo" || workflowMode === "storyboardImage")) {
      const isImage = workflowMode === "storyboardImage";
      const raw = isImage ? workflowStoryboardImage : workflowStoryboardVideo;
      const setRaw = (v: string) => isImage ? setWorkflowStoryboardImage(v) : setWorkflowStoryboardVideo(v);
      const selectedShots = selectedOverviewShotIds.length ? selectedOverviewShotIds : storyboardShots.map((shot) => shot.id);
      const batchGenerateFromOverview = (kind: "sketch" | "image" | "video", shotIds: string[]) => {
        const queue = storyboardShots.filter((shot) => shotIds.includes(shot.id));
        if (!queue.length) return;
        if (kind === "video") batchGenerateVideosForShots(queue);
        else batchGenerateImagesForShots(queue);
      };
      return (
        <div className="space-y-3">
          <div className="rounded-2xl border border-brand/15 bg-brand/5 p-3 text-[11px] leading-relaxed text-text-secondary">
            <div className="mb-1 font-semibold text-text-primary">镜头列表 = 逻辑/空间审核层</div>
            <div>先检查镜头顺序、场景切换、人物站位、动作因果和视频提示词；确认后再生成分镜图。画布只承载资产、分镜图和视频产物。</div>
          </div>

          {storyboardShots.length > 0 && (
            <ShotOverviewTable
              shots={storyboardShots}
              assets={assets}
              generationJobs={generationJobs}
              directorBlocks={directorBlocks}
              activeShotId={activeShotId}
              selectedShotIds={selectedOverviewShotIds}
              onSelectShot={(shotId) => {
                setActiveShotId(shotId);
                setWorkflowView("step");
              }}
              onToggleSelectedShot={(shotId) => setSelectedOverviewShotIds((prev) => prev.includes(shotId) ? prev.filter((id) => id !== shotId) : [...prev, shotId])}
              onSelectAll={setSelectedOverviewShotIds}
              onBatchGenerate={batchGenerateFromOverview}
              onBatchDelete={(shotIds) => {
                setStoryboardShots((prev) => prev.filter((shot) => !shotIds.includes(shot.id)).map((shot, index) => ({ ...shot, index: index + 1 })));
                setSelectedOverviewShotIds([]);
                if (activeShotId && shotIds.includes(activeShotId)) setActiveShotId(undefined);
              }}
              onReorderShots={reorderShots}
              isStoryboardSketchAsset={isStoryboardSketchAsset}
              getShotStatusLabel={getShotStatusLabel}
              assetViewUrl={assetViewUrl}
            />
          )}

          <div className="space-y-3 rounded-2xl border border-surface-border bg-surface-card/70 p-3">
            <h3 className="text-sm font-semibold text-text-primary">{isImage ? "生成/解析分镜图提示词" : "生成/解析视频提示词"}</h3>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={isImage ? "输入分镜图提示词..." : "输入分镜剧本或 Seedance 视频提示词..."}
              className="h-40 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => generateWorkflow(workflowMode)}
                disabled={Boolean(workflowGenerating)}
                className="flex items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                {workflowGenerating === workflowMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                一键生成提示词
              </button>
              <button
                type="button"
                onClick={() => mergeStoryboardShots(raw, isImage ? "storyboard" : "seedance")}
                disabled={!raw.trim()}
                className="flex items-center justify-center gap-1 rounded-lg bg-surface-card py-2 text-[11px] font-medium text-text-primary hover:bg-surface-border disabled:opacity-50"
              >
                <Layers className="h-3.5 w-3.5" />
                解析为镜头列表
              </button>
            </div>
            {storyboardShots.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => batchGenerateImagesForShots(storyboardShots.filter((shot) => selectedShots.includes(shot.id)))}
                  disabled={Boolean(batchGenerating) || !selectedShots.length}
                  className="flex items-center justify-center gap-1 rounded-lg bg-slate-950 py-2 text-[11px] font-semibold text-white hover:bg-brand disabled:opacity-50"
                >
                  {batchGenerating === "images" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  生成分镜图
                </button>
                <button
                  type="button"
                  onClick={() => batchGenerateVideosForShots(storyboardShots.filter((shot) => selectedShots.includes(shot.id)))}
                  disabled={Boolean(batchGenerating) || !selectedShots.length}
                  className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 py-2 text-[11px] font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {batchGenerating === "videos" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                  生成视频
                </button>
              </div>
            )}
            <div className="rounded-lg bg-surface-base p-3 text-[10px] text-text-secondary">
              <p className="mb-1 font-medium text-text-primary">正确顺序</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>镜头列表先审核逻辑、空间、动作连续性。</li>
                <li>分镜图用于确认构图、人物视觉和首帧候选。</li>
                <li>视频节点只使用明确首帧或纯文本提示，不把镜头列表当首帧。</li>
              </ul>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-text-secondary">总览</p>
        <p className="mt-1 text-xs text-text-tertiary">点击左侧步骤或画布节点开始编辑</p>
      </div>
    );
  })();

  const activeEpisodeScript = episodeScripts.find((item) => item.episode === activeEpisode);

  const flowStepLabels: Array<{ id: StoryFlowStage; label: string }> = [
    { id: "idea", label: "AI聊剧本" },
    { id: "ideaContent", label: "创意内容" },
    { id: "outline", label: "剧本大纲" },
    { id: "episodeScript", label: "分集正文" },
    { id: "canvas", label: `第${activeEpisode}集画布` },
  ];

  const workflowModelPanel = (
    <div className="rounded-[24px] border border-white/[0.08] bg-black/30 p-3 text-left shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-white">模型策略</div>
          <div className="text-[10px] text-white/40">按成本/质量选择文本工作流模型</div>
        </div>
        <button type="button" onClick={() => setShowModelAdvanced((value) => !value)} className="rounded-full border border-white/[0.1] px-2.5 py-1 text-[10px] text-white/60 hover:bg-white hover:text-black">
          {showModelAdvanced ? "收起" : "高级"}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1">
        {(["economy", "balanced", "quality"] as WorkflowModelStrategy[]).map((strategy) => (
          <button key={strategy} type="button" onClick={() => setWorkflowModelStrategy(strategy)} className={cn("rounded-full px-2 py-1.5 text-[10px] font-semibold transition", modelStrategy === strategy ? "bg-white text-black" : "text-white/45 hover:bg-white/[0.08] hover:text-white")}>
            {WORKFLOW_MODEL_STRATEGY_LABELS[strategy]}
          </button>
        ))}
      </div>
      <div className="mt-2 text-[10px] leading-5 text-white/45">
        当前：聊剧本/改剧本 {getWorkflowModel("ideaChat")}，批量生成 {getWorkflowModel("episodeScript")}
      </div>
      {showModelAdvanced && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
          {WORKFLOW_MODEL_TASKS.map((task) => (
            <label key={task.key} className="block rounded-2xl border border-white/[0.06] bg-white/[0.04] p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-white/85">{task.label}</span>
                <span className="text-[9px] text-white/35">{task.desc}</span>
              </div>
              <select value={getWorkflowModel(task.key)} onChange={(event) => updateWorkflowModel(task.key, event.target.value)} className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none focus:border-white/40">
                {WORKFLOW_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>{model.label} · {model.cost}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  const storyFlowPage = flowStage !== "canvas" ? (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.10),transparent_28%),linear-gradient(135deg,#050505_0%,#0b0b0d_48%,#17120f_100%)] text-white">
      <header className="flex h-14 items-center justify-between border-b border-white/[0.08] bg-black/35 px-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] text-white/70 transition hover:bg-white hover:text-black"
            title="返回聊天"
            aria-label="返回聊天"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-black shadow-sm"><Clapperboard className="h-4 w-4" /></span>
          <div>
            <div className="text-sm font-semibold">{activeProject?.title || "未命名漫剧"}</div>
            <div className="text-[11px] text-white/40">从想法到剧本，再进入单集画布</div>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1">
          {flowStepLabels.map((step, index) => (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                if (step.id === "canvas") {
                  void enterEpisodeCanvas(activeEpisode);
                  return;
                }
                if ((step.id === "ideaContent" || step.id === "outline") && !outlineSource.trim()) {
                  toast.info("先提炼创意内容");
                  return;
                }
                setFlowStage(step.id);
              }}
              className={cn("rounded-full px-3 py-1.5 text-[11px] font-semibold transition", flowStage === step.id ? "bg-white text-black" : "text-white/45 hover:bg-white/[0.08] hover:text-white")}
            >
              {index + 1}. {step.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void enterEpisodeCanvas(activeEpisode)} className="rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white hover:text-black">
          跳到画布
        </button>
      </header>

      {flowStage === "idea" && (
        <main className="mx-auto flex h-[calc(100vh-56px)] max-w-6xl gap-5 p-5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.05] shadow-[0_32px_100px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="border-b border-white/[0.08] px-6 py-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200/80"><MessageSquare className="h-4 w-4" /> AI聊剧本内容</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">先把短剧想法聊清楚</h1>
              <p className="mt-2 text-sm leading-6 text-white/45">这里不是生成小说。先把类型、核心梗、主角处境、集数、结尾钩子聊清楚，再提炼成可确认编辑的最终有效创意。</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {ideaChatMessages.length ? (
                <div className="space-y-3">
                  {ideaChatMessages.map((msg) => (
                    <div key={msg.id} className={cn("max-w-[82%] rounded-3xl border px-4 py-3 text-sm leading-6", msg.role === "user" ? "ml-auto border-white/[0.12] bg-white text-black" : "border-white/[0.08] bg-black/30 text-white/72")}>
                      <RichMarkdown content={msg.content} inverse={msg.role === "user"} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-center">
                  <div className="max-w-xl">
                    <Sparkles className="mx-auto mb-4 h-10 w-10 text-amber-200/70" />
                    <div className="text-xl font-semibold">例如：5集中式民俗恐怖，响器班误入黄泉戏班，规则压迫，主角靠观察交易漏洞破局。</div>
                    <div className="mt-3 text-sm leading-6 text-white/42">也可以粘贴已有小说梗概/剧情片段，但流程目标是改成短剧大纲，不是续写小说。</div>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-white/[0.08] bg-black/20 p-4">
              <textarea
                value={ideaInput}
                onChange={(e) => setIdeaInput(e.target.value)}
                placeholder="输入你的短剧想法：类型、主角、核心梗、集数、目标受众、想要的情绪..."
                className="h-28 w-full resize-none rounded-3xl border border-white/[0.1] bg-black/35 p-4 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-white/35"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/52 hover:bg-white hover:text-black">
                  <UploadCloud className="h-3.5 w-3.5" /> 上传小说/梗概文本
                  <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown,text/x-markdown" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    readTextImportFile(file, setIdeaInput);
                  }} />
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={chatAboutIdea} disabled={ideaChatting} className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white/72 hover:bg-white hover:text-black disabled:opacity-60">
                    {ideaChatting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                    发送给 AI
                  </button>
                  <button type="button" onClick={extractEffectiveIdeaContent} disabled={ideaExtracting || ideaChatting || outlineGenerating} className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-sm hover:bg-white/88 disabled:opacity-60">
                    {ideaExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    提炼创意内容
                  </button>
                </div>
              </div>
            </div>
          </section>
          <aside className="w-[360px] space-y-4 rounded-[32px] border border-white/[0.08] bg-black/28 p-5 backdrop-blur-xl">
            {workflowModelPanel}
            <div className="text-sm font-semibold">生成目标</div>
            <div className="mt-4 space-y-3 text-sm text-white/55">
              <div className="rounded-2xl bg-white/[0.05] p-4"><b className="text-white/78">最终有效创意</b><br />从聊天中排除被否决方案，只保留用户确认的创意。</div>
              <div className="rounded-2xl bg-white/[0.05] p-4"><b className="text-white/78">剧本摘要</b><br />故事类型、核心梗、一句话故事、人物小传、故事梗概。</div>
              <div className="rounded-2xl bg-white/[0.05] p-4"><b className="text-white/78">分集剧本</b><br />按集拆出简介、主事件、关系推进和结尾钩子。</div>
            </div>
          </aside>
        </main>
      )}

      {flowStage === "ideaContent" && (
        <main className="mx-auto grid h-[calc(100vh-56px)] max-w-6xl grid-cols-[minmax(0,1fr)_360px] gap-5 overflow-hidden p-5">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.05] shadow-[0_32px_100px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="border-b border-white/[0.08] px-6 py-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200/80"><Sparkles className="h-4 w-4" /> 创意内容</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">确认最终有效创意</h1>
              <p className="mt-2 text-sm leading-6 text-white/45">这是后续剧本摘要、分集正文、资产、分镜和视频提示词的唯一上游。被否决的聊天想法不会进入这里。</p>
            </div>
            <textarea
              value={outlineSource}
              onChange={(e) => { setOutlineSource(e.target.value); setOriginalIdea(e.target.value); setWorkflowIdea(e.target.value); setScriptSourceExcerpt(e.target.value.slice(0, 2000)); }}
              placeholder="这里会显示从 AI聊剧本中提炼出的最终有效创意。你可以直接修改、删掉不需要的设定，再生成剧本大纲。"
              className="min-h-0 flex-1 resize-none bg-transparent p-6 text-sm leading-7 text-white/72 outline-none placeholder:text-white/25"
            />
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] bg-black/20 p-4">
              <button type="button" onClick={() => setFlowStage("idea")} className="rounded-full border border-white/[0.1] px-4 py-2.5 text-xs font-semibold text-white/60 hover:bg-white hover:text-black">
                返回继续聊
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={extractEffectiveIdeaContent} disabled={ideaExtracting || ideaChatting || outlineGenerating} className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white/72 hover:bg-white hover:text-black disabled:opacity-60">
                  {ideaExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  重新提炼
                </button>
                <button type="button" onClick={generateScriptOutlineFromIdea} disabled={outlineGenerating || ideaExtracting || !outlineSource.trim()} className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-sm hover:bg-white/88 disabled:opacity-60">
                  {outlineGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  确认并生成剧本大纲
                </button>
              </div>
            </div>
          </section>
          <aside className="space-y-4 overflow-y-auto rounded-[32px] border border-white/[0.08] bg-black/28 p-5 backdrop-blur-xl">
            {workflowModelPanel}
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.045] p-4 text-sm leading-6 text-white/55">
              <div className="mb-2 text-sm font-semibold text-white">检查重点</div>
              <ul className="list-inside list-disc space-y-1 text-xs leading-5 text-white/48">
                <li>只保留最后确认的方向。</li>
                <li>删掉 AI 提过但你没采纳的选项。</li>
                <li>确认主角、规则、人物关系和集数。</li>
                <li>后续大纲/正文/分镜只读这份创意。</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.045] p-4 text-xs leading-5 text-white/42">
              <div className="mb-2 text-sm font-semibold text-white/82">上一阶段聊天</div>
              {ideaChatMessages.length ? `${ideaChatMessages.length} 条消息已用于提炼。` : "还没有聊天记录，可返回 AI聊剧本继续补充。"}
            </div>
            <details className="rounded-3xl border border-white/[0.08] bg-white/[0.045] p-4 text-xs leading-5 text-white/48">
              <summary className="cursor-pointer text-sm font-semibold text-white/82">用户原文参考{ideaSourceReference ? ` · ${ideaSourceReference.length} 字` : ""}</summary>
              <p className="mt-2 text-white/38">仅作回溯参考，默认不传给剧本大纲/正文；后续生成只读取左侧结构化剧情母版。</p>
              <textarea
                value={ideaSourceReference}
                onChange={(e) => setIdeaSourceReference(e.target.value)}
                placeholder="用户最后确认的原始剧情文本会放在这里，折叠保存，不混入最终有效创意。"
                className="mt-3 h-56 w-full resize-none rounded-2xl border border-white/[0.08] bg-black/35 p-3 text-xs leading-5 text-white/58 outline-none placeholder:text-white/25"
              />
            </details>
          </aside>
        </main>
      )}

      {flowStage === "outline" && (
        <main className="grid h-[calc(100vh-56px)] grid-cols-[360px_1fr] gap-5 overflow-hidden p-5">
          <section className="flex min-h-0 flex-col gap-4 overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.05] p-4">
            {workflowModelPanel}
            <div className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/[0.08] bg-black/20">
              <div className="border-b border-white/[0.08] px-5 py-4 text-sm font-semibold">最终有效创意</div>
              <textarea value={outlineSource} onChange={(e) => { setOutlineSource(e.target.value); setOriginalIdea(e.target.value); setWorkflowIdea(e.target.value); }} className="h-[calc(100%-53px)] w-full resize-none bg-transparent p-5 text-sm leading-6 text-white/68 outline-none" />
            </div>
          </section>
          <section className="min-w-0 overflow-y-auto rounded-[28px] border border-white/[0.08] bg-black/24 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">剧本大纲</h2>
                <p className="mt-1 text-xs text-white/38">包含剧本摘要和分集剧本，确认后生成第一集正文。</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={generateScriptOutlineFromIdea} disabled={outlineGenerating} className="rounded-full border border-white/[0.1] px-4 py-2 text-xs font-semibold text-white/60 hover:bg-white hover:text-black disabled:opacity-50">重新生成</button>
                <button type="button" onClick={confirmOutlineAndGenerateFirstEpisode} disabled={episodeScriptGenerating !== null} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">{episodeScriptGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />} 确认分集，生成第1集正文</button>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-3xl border border-white/[0.08] bg-white/[0.045] p-4">
                <div className="text-sm font-semibold">剧本摘要</div>
                {([
                  ["episodeCount", "自定义集数"], ["genre", "故事类型"], ["targetAudience", "目标受众"], ["coreHook", "核心梗"], ["logline", "一句话故事"], ["charactersText", "人物小传"], ["synopsis", "故事梗概"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block text-[11px] font-semibold text-white/42">
                    {label}
                    {key === "episodeCount" ? (
                      <input type="number" value={scriptSummary.episodeCount} onChange={(e) => setScriptSummary((prev) => ({ ...prev, episodeCount: Number(e.target.value || 1) }))} className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none" />
                    ) : (
                      <textarea value={String(scriptSummary[key] || "")} onChange={(e) => setScriptSummary((prev) => ({ ...prev, [key]: e.target.value }))} className={cn("mt-1 w-full resize-none rounded-xl border border-white/[0.08] bg-black/35 p-3 text-sm leading-5 text-white outline-none", key === "charactersText" || key === "synopsis" ? "h-32" : "h-16")} />
                    )}
                  </label>
                ))}
              </div>
              <div className="space-y-3 rounded-3xl border border-white/[0.08] bg-white/[0.045] p-4">
                <div className="flex items-center justify-between"><div className="text-sm font-semibold">分集剧本</div><span className="text-[11px] text-white/35">{episodeOutlines.length} 集</span></div>
                {episodeOutlines.map((episode, index) => (
                  <div key={episode.episode} className="rounded-2xl border border-white/[0.08] bg-black/28 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <input value={episode.title} onChange={(e) => setEpisodeOutlines((prev) => prev.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none" />
                      <button type="button" onClick={() => generateEpisodeScript(episode)} disabled={episodeScriptGenerating !== null} className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] font-semibold text-white/58 hover:bg-white hover:text-black">生成此集</button>
                    </div>
                    <textarea value={episode.summary} onChange={(e) => setEpisodeOutlines((prev) => prev.map((item, i) => i === index ? { ...item, summary: e.target.value } : item))} className="h-32 w-full resize-none bg-transparent text-xs leading-5 text-white/58 outline-none" />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      {flowStage === "episodeScript" && (
        <main className="mx-auto flex h-[calc(100vh-56px)] max-w-6xl flex-col gap-4 overflow-hidden p-5">
          <div className="flex items-center justify-between gap-4 rounded-[26px] border border-white/[0.08] bg-white/[0.05] px-5 py-4">
            <div><div className="text-lg font-semibold">分集正文</div><div className="mt-1 text-xs text-white/38">默认已生成第一集正文，确认后进入当前集画布。</div></div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input value={scriptRevisionInstruction} onChange={(e) => setScriptRevisionInstruction(e.target.value)} placeholder="一句话修改当前集：强化钩子/压缩节奏/改对白..." className="h-9 min-w-[260px] max-w-md flex-1 rounded-full border border-white/[0.1] bg-black/30 px-4 text-xs text-white outline-none placeholder:text-white/28" />
              <button type="button" onClick={() => reviseScriptWithInstruction()} disabled={scriptRevising} className="flex items-center gap-1 rounded-full border border-white/[0.1] px-4 py-2 text-xs font-semibold text-white/68 hover:bg-white hover:text-black disabled:opacity-50">{scriptRevising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} 一键改剧本</button>
              <button type="button" onClick={async () => { setEpisodeScriptGenerating("all"); for (const outline of episodeOutlines) await generateEpisodeScript(outline); setEpisodeScriptGenerating(null); }} disabled={episodeScriptGenerating !== null} className="rounded-full border border-white/[0.1] px-4 py-2 text-xs font-semibold text-white/60 hover:bg-white hover:text-black disabled:opacity-50">生成全部集正文</button>
              <button type="button" onClick={() => enterEpisodeCanvas(activeEpisode)} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">进入第{activeEpisode}集画布</button>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_320px] gap-4">
            <aside className="overflow-y-auto rounded-[26px] border border-white/[0.08] bg-white/[0.04] p-3">
              {episodeOutlines.map((outline) => {
                const done = episodeScripts.some((item) => item.episode === outline.episode);
                return <button key={outline.episode} type="button" onClick={() => { setActiveEpisode(outline.episode); const script = episodeScripts.find((item) => item.episode === outline.episode); if (script) setWorkflowScript(extractVisibleEpisodeScript(script.script)); }} className={cn("mb-2 w-full rounded-2xl border px-3 py-3 text-left text-xs transition", activeEpisode === outline.episode ? "border-white bg-white text-black" : "border-white/[0.08] bg-black/20 text-white/58 hover:bg-white/[0.08]")}>{outline.title}<div className="mt-1 text-[10px] opacity-60">{done ? "正文已生成" : "未生成"}</div></button>;
              })}
            </aside>
            <section className="overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.045]">
              <div className="border-b border-white/[0.08] px-5 py-3 text-sm font-semibold">第{activeEpisode}集正文</div>
              <textarea value={workflowScript} onChange={(e) => { setWorkflowScript(e.target.value); setEpisodeScripts((prev) => prev.map((item) => item.episode === activeEpisode ? { ...item, script: e.target.value, scenes: [] } : item)); }} className="h-[calc(100%-45px)] w-full resize-none bg-transparent p-5 text-sm leading-7 text-white/72 outline-none" />
            </section>
            <aside className="overflow-y-auto rounded-[26px] border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">结构化场次</div>
                <span className="text-[10px] text-white/35">{activeEpisodeScript?.scenes?.length || 0} 场</span>
              </div>
              <div className="mt-3 space-y-3">
                {activeEpisodeScript?.scenes?.length ? activeEpisodeScript.scenes.map((scene) => (
                  <div key={`${activeEpisode}-${scene.scene}`} className="rounded-2xl border border-white/[0.08] bg-black/24 p-3 text-xs text-white/58">
                    <div className="font-semibold text-white/82">场{scene.scene}｜{scene.location || "地点未标注"}</div>
                    <div className="mt-1 text-[10px] text-white/38">{scene.time || "时间未标注"} · {scene.characters.join("、") || "人物未标注"}</div>
                    {scene.visualAction && <div className="mt-2 leading-5"><b className="text-white/68">动作：</b>{scene.visualAction}</div>}
                    {scene.dialogue.length > 0 && <div className="mt-2 leading-5"><b className="text-white/68">对白：</b>{scene.dialogue.slice(0, 2).map((line) => `${line.character || "角色"}：${line.text}`).join(" / ")}</div>}
                    {scene.hook && <div className="mt-2 leading-5"><b className="text-white/68">钩子：</b>{scene.hook}</div>}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/[0.1] p-4 text-xs leading-5 text-white/42">旧剧本或手动编辑后的文本暂无结构化场次。重新生成或一键改剧本后，会生成 scenes[] 并供后续资产/分镜流程使用。</div>
                )}
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  ) : null;

  const canvasStoryFlowNav = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {flowStepLabels.map((step, index) => {
          const isCanvasStep = step.id === "canvas";
          const isActive = isCanvasStep;
          const label = isCanvasStep ? `第${activeEpisode}集画布` : step.label;
          return (
            <div key={step.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (step.id === "canvas") return;
                  setFlowStage(step.id);
                  if (step.id === "episodeScript") {
                    const script = episodeScripts.find((item) => item.episode === activeEpisode);
                    if (script) setWorkflowScript(extractVisibleEpisodeScript(script.script));
                  }
                }}
                className={cn(
                  "flex h-8 min-w-[104px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition",
                  isActive ? "border-white bg-white text-black" : "border-white/[0.08] bg-white/[0.04] text-white/58 hover:bg-white/[0.1] hover:text-white",
                )}
              >
                {label}
              </button>
              {index < flowStepLabels.length - 1 && <ChevronRight className="h-3 w-3 text-white/[0.2]" />}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setWorkflowMode("assets");
            setWorkflowView("step");
            if (semanticAssets.length) setActiveSemanticAssetId(semanticAssets[0].id);
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
            workflowView === "step" && workflowMode === "assets" ? "border-white bg-white text-black" : "border-white/[0.12] bg-white/[0.06] text-white/72 hover:bg-white hover:text-black",
          )}
        >
          角色场景
        </button>
        <button
          type="button"
          onClick={() => {
            setWorkflowMode("storyboardImage");
            setWorkflowView("step");
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
            workflowView === "step" && (workflowMode === "storyboardImage" || workflowMode === "storyboardVideo") ? "border-white bg-white text-black" : "border-white/[0.12] bg-white/[0.06] text-white/72 hover:bg-white hover:text-black",
          )}
        >
          分镜成片
        </button>
        <button
          type="button"
          onClick={() => {
            setAssetPreprocessOpen(true);
            generateWorkflow("assets");
          }}
          disabled={Boolean(workflowGenerating)}
          className="rounded-full border border-brand/30 bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {workflowGenerating === "assets" ? "提取中..." : "提取资产候选"}
        </button>
        <button
          type="button"
          onClick={() => {
            const script = episodeScripts.find((item) => item.episode === activeEpisode);
            if (script) setWorkflowScript(extractVisibleEpisodeScript(script.script));
            setFlowStage("episodeScript");
          }}
          className="rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/72 hover:bg-white hover:text-black"
        >
          返回分集正文
        </button>
      </div>
    </div>
  );

  // ===== 保存项目 =====
  const saveProject = useCallback(() => {
    if (!activeProject) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              updatedAt: new Date().toISOString(),
              idea: workflowIdea,
              flowStage,
              modelStrategy,
              workflowModels,
              originalIdea,
              outlineSource,
              ideaChatMessages,
              scriptSummary,
              episodeOutlines,
              episodeScripts,
              activeEpisode,
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
              generatorGroups,
            }
          : p
      )
    );
    toast.success("已保存项目");
  }, [activeProject, workflowIdea, flowStage, modelStrategy, workflowModels, originalIdea, outlineSource, ideaChatMessages, scriptSummary, episodeOutlines, episodeScripts, activeEpisode, workflowNovel, scriptSourceExcerpt, scriptAdaptationInstruction, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, assets, selectedAssetIds, imagePrompt, videoPrompt, storyboardShots, activeShotId, generationJobs, semanticAssets, directorBlocks, generatorGroups, setProjects]);

  if (activeProject && loadedProjectId !== activeProject.id) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base text-sm text-text-secondary">
        正在打开 AI 漫剧工作台...
      </div>
    );
  }

  if (storyFlowPage) return storyFlowPage;

  return (
    <div className="fixed inset-0 z-50">
      <ManjuStudioLayout
        projectName={activeProject?.title || t("seedreamBeta.projects.newProject")}
        activeStep={workflowView === "videoSegments" ? "storyboardVideo" : workflowMode}
        nodeAssets={assets.map((asset) => ({
          id: asset.id,
          publicId: asset.publicId,
          name: asset.name,
          category: asset.role || asset.type,
          kind: asset.role || asset.type,
          summary: asset.source || asset.mimeType || "",
          url: asset.url,
          image_url: asset.url,
        }))}
        mentionAssets={semanticAssets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          category: asset.kind,
          summary: asset.summary || asset.lockPrompt,
          lockPrompt: asset.lockPrompt,
          imageUrl: asset.imageUrl,
          image_url: asset.imageUrl,
        }))}
        onStepChange={(step) => {
          setStudioSelectedNodeId(null);
          if (step === "overview") {
            setWorkflowView("overview");
            setActiveShotId(undefined);
            setActiveSemanticAssetId(undefined);
          } else if (step === "videoSegments") {
            setWorkflowView("videoSegments");
          } else {
            setWorkflowMode(step as WorkflowMode);
            setWorkflowView("step");
            if (step === "assets" && semanticAssets.length) setActiveSemanticAssetId(semanticAssets[0].id);
            if ((step === "storyboardVideo" || step === "storyboardImage") && storyboardShots.length) setActiveShotId(storyboardShots[0].id);
          }
        }}
        onGenerate={(step) => {
          setWorkflowMode(step);
          setWorkflowView("step");
          generateWorkflow(step);
        }}
        generating={workflowGenerating}
        nodes={studioNodes}
        connections={studioConnections}
        onNodeMove={handleStudioNodeMove}
        onNodeSelect={setStudioSelectedNodeId}
        onNodeDoubleClick={handleStudioNodeDoubleClick}
        onUpdateNodeContent={handleUpdateNodeContent}
        onAddNode={handleStudioAddNode}
        onDeleteNode={handleStudioNodeDelete}
        onGenerateAsset={(assetId) => {
          generateNodeAssetImage(assetId);
        }}
        onNodeGenerate={handleComposerGenerate}
        composerSettings={selectedComposerSettings}
        composerOptions={{
          imageAspects: IMAGE_ASPECTS,
          imageResolutions: IMAGE_RESOLUTIONS,
          videoModels: VIDEO_MODELS,
          videoAspects: VIDEO_ASPECTS,
          videoResolutions: getVideoResolutionOptions(selectedComposerSettings.videoModel),
          videoDurations: getVideoDurationOptions(selectedComposerSettings.videoModel),
        }}
        onComposerSettingsChange={handleComposerSettingsChange}
        onBindAssetMention={handleBindAssetMention}
        storyboardShotCount={storyboardShots.length}
        storyboardImageCount={storyboardFormalImageReadyCount}
        storyboardVideoCount={storyboardVideoReadyCount}
        onRewriteAsset={handleRewriteNodeAsset}
        onChatAsset={handleChatNodeAsset}
        assetRewriting={Boolean(assetRegeneratingId)}
        assetChatting={assetChatting}
        composerGenerating={isGenerating || videoGenerating || Boolean(batchGenerating) || Boolean(assetImageGeneratingId)}
        onAutoLayout={autoLayoutNodes}
        onBatchGenerate={(nodeIds, mode) => createGeneratorGroupNode(nodeIds, mode)}
        onConnectNodes={handleCanvasConnectNodes}
        onDropAsset={handleDropAssetToCanvas}
        onDeleteAsset={(assetId, source) => {
          if (source === "library") {
            const asset = assets.find((item) => item.id === assetId || item.publicId === assetId);
            const ok = typeof window === "undefined" ? true : window.confirm(`删除素材「${asset?.name || "未命名素材"}」？\n\n会同时解除镜头和语义资产中的引用。`);
            if (!ok) return;
            removeAsset(asset?.id || assetId);
            return;
          }
          handleDeleteSemanticAsset(assetId);
        }}
        onSave={saveProject}
        onExport={() => {
          const data = {
            project: activeProject,
            nodes: studioNodes,
            connections: studioConnections,
            generatorGroups,
            exportedAt: new Date().toISOString(),
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${activeProject?.title || "seedream-project"}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("已导出项目");
        }}
        onImportScriptFile={handleImportScriptAndShotsFile}
        onImport={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json";
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const data = JSON.parse(text);
              if (data.project) {
                setProjects((prev) => [data.project, ...prev]);
                toast.success("已导入项目");
              }
            } catch {
              toast.error("导入失败，请检查文件格式");
            }
          };
          input.click();
        }}
        onNewProject={() => {
          const project = createProject(t("seedreamBeta.projects.newProject"));
          toast.success(`已创建项目：${project.title}`);
        }}
        onOpenProject={() => toast.info("请使用顶部保存面板切换项目")}
        onSettings={() => toast.info("设置开发中")}
        rightPanel={rightPanelContent}
        storyFlowNav={canvasStoryFlowNav}
      >
        <div className="absolute left-4 top-4 z-30 rounded-full border border-white/[0.08] bg-[#0c0c0d]/82 px-3 py-1.5 text-[11px] font-medium text-white/56 shadow-[0_12px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          当前：第{activeEpisode}集 · {activeEpisodeShots.length} 镜头
        </div>
        <div className="absolute left-1/2 top-4 z-30 flex max-w-[calc(100%-160px)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.1] bg-[#0c0c0d]/88 px-3 py-2 shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/52">
            镜头列表 · {activeEpisodeShots.length}
          </span>
          <button
            type="button"
            onClick={() => {
              setWorkflowMode("storyboardImage");
              setWorkflowView("step");
            }}
            className="shrink-0 rounded-full border border-white bg-white px-3 py-1.5 text-xs font-semibold text-black shadow-sm hover:bg-white/90"
          >
            分镜成片
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkflowMode("storyboardImage");
              setWorkflowView("step");
              if (activeEpisodeShots.length) setActiveShotId(activeEpisodeShots[0].id);
              void batchGenerateImagesForShots(activeEpisodeShots);
            }}
            disabled={Boolean(workflowGenerating) || Boolean(batchGenerating) || !activeEpisodeShots.length}
            className="shrink-0 rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/72 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {batchGenerating === "images" ? "生成中..." : "生成分镜图"}
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkflowMode("storyboardVideo");
              setWorkflowView("step");
              if (activeEpisodeShots.length) setActiveShotId(activeEpisodeShots[0].id);
              void batchGenerateVideosForShots(activeEpisodeShots);
            }}
            disabled={Boolean(workflowGenerating) || Boolean(batchGenerating) || !activeEpisodeShots.length}
            className="shrink-0 rounded-full border border-brand/30 bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {batchGenerating === "videos" ? "生成中..." : "生成视频"}
          </button>
        </div>
        <FloatingToolbar
          onAddNode={handleStudioAddNode}
          onHelp={() => toast.info("画布操作：滚轮缩放、拖拽移动、双击节点编辑")}
        />
      </ManjuStudioLayout>
      {assetPreprocessOpen && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#0f1012] [color-scheme:dark] shadow-[0_28px_100px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] bg-white/[0.04] px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <h2 className="text-base font-semibold text-white">剧情资产预处理</h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-white/68">
                  从剧本大纲、分集正文和当前镜头列表提取角色、场景、道具、风格候选。人物资产优先读大纲人物小传；这里不会生成图片，确认后再录入资产库。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssetPreprocessOpen(false)}
                className="rounded-full p-2 text-white/42 hover:bg-white/[0.08] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-black/24 p-3">
                <div className="text-xs text-white/70">
                  当前候选：<span className="font-semibold text-white">{assetCandidates.length}</span> 个 · 已勾选：<span className="font-semibold text-white">{assetCandidates.filter((asset) => asset.selected).length}</span> 个
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => generateWorkflow("assets")}
                    disabled={Boolean(workflowGenerating)}
                    className="rounded-full border border-brand/30 bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {workflowGenerating === "assets" ? "提取中..." : assetCandidates.length ? "重新提取" : "开始提取"}
                  </button>
                  <button
                    type="button"
                    onClick={applySelectedAssetCandidates}
                    disabled={!assetCandidates.some((asset) => asset.selected)}
                    className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    录入资产库
                  </button>
                </div>
              </div>

              <div className="mb-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white">预设提取提示词</div>
                    <button
                      type="button"
                      onClick={() => setAssetExtractInstruction(DEFAULT_ASSET_EXTRACT_INSTRUCTION)}
                      className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-white/48 hover:bg-white/[0.08] hover:text-white"
                    >
                      恢复默认
                    </button>
                  </div>
                  <textarea
                    value={assetExtractInstruction}
                    onChange={(event) => setAssetExtractInstruction(event.target.value)}
                    className="h-44 w-full rounded-xl border border-white/15 bg-[#17191f] p-3 text-[13px] leading-6 text-white outline-none placeholder:text-white/45 focus:border-brand focus:bg-[#1b1e25]"
                    placeholder="这里是默认资产提取规则，会和剧情材料一起发送给模型"
                  />
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white">剧情材料来源预览</div>
                    <div className="text-[10px] text-white/58">大纲人物小传 / 正文 / 镜头列表自动读取</div>
                  </div>
                  <pre className="h-44 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/15 bg-[#17191f] p-3 text-[12px] leading-6 text-white/82">
                    {(getAssetExtractionSourceInput() || "暂无剧本大纲、剧情正文或镜头列表。请先确认剧本大纲/生成分集正文，或返回剧情阶段补充内容。").slice(0, 4000)}
                  </pre>
                </div>
              </div>

              {assetCandidates.length > 0 && assetCandidates.some((candidate) => !candidate.summary.trim() || !candidate.lockPrompt.trim()) && (
                <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/8 p-3 text-xs leading-relaxed text-amber-100">
                  有候选资产缺少描述或生图锁定词，可以点击“重新提取”让模型按上方预设补全，或直接在卡片里手动修改。
                </div>
              )}

              {assetCandidates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.03] p-8 text-center">
                  <div className="text-sm font-semibold text-white">暂无资产候选</div>
                  <p className="mt-2 text-xs leading-relaxed text-white/64">
                    点击“开始提取”，系统会从本集剧情正文或当前镜头列表里整理出需要进入资产库的角色、场景、道具和风格。
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {assetCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={candidate.selected}
                          onChange={(event) => updateAssetCandidate(candidate.id, { selected: event.target.checked })}
                          className="h-4 w-4 accent-brand"
                        />
                        <select
                          value={candidate.kind}
                          onChange={(event) => updateAssetCandidate(candidate.id, { kind: event.target.value as SemanticAssetKind })}
                          className="rounded-lg border border-white/15 bg-[#17191f] px-2 py-1.5 text-xs text-white outline-none focus:border-brand"
                        >
                          <option value="character">角色</option>
                          <option value="scene">场景</option>
                          <option value="prop">道具</option>
                          <option value="style">风格</option>
                        </select>
                        <input
                          value={candidate.name}
                          onChange={(event) => updateAssetCandidate(candidate.id, { name: event.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#17191f] px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/45 focus:border-brand"
                          placeholder="资产名称"
                        />
                      </div>
                      <label className="mb-1 block text-[11px] font-semibold text-white/72">资产描述</label>
                      <textarea
                        value={candidate.summary}
                        onChange={(event) => updateAssetCandidate(candidate.id, { summary: event.target.value })}
                        className="mb-3 h-20 w-full rounded-xl border border-white/15 bg-[#17191f] p-3 text-[13px] leading-6 text-white outline-none placeholder:text-white/45 focus:border-brand focus:bg-[#1b1e25]"
                        placeholder="人物身份/性格、场景空间、道具作用、剧情功能..."
                      />
                      <label className="mb-1 block text-[11px] font-semibold text-white/72">生图锁定词</label>
                      <textarea
                        value={candidate.lockPrompt}
                        onChange={(event) => updateAssetCandidate(candidate.id, { lockPrompt: event.target.value })}
                        className="h-20 w-full rounded-xl border border-white/15 bg-[#17191f] p-3 text-[13px] leading-6 text-white outline-none placeholder:text-white/45 focus:border-brand focus:bg-[#1b1e25]"
                        placeholder="后续生成图片用的一致性提示词，可先修改再录入资产库"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}