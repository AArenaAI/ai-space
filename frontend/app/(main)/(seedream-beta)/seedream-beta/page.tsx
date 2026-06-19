"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Copy, Download, FileText, ImageIcon, Layers, Loader2, MessageSquare, PanelLeftOpen, Paperclip, Play, Plus, RefreshCw, Send, Sparkles, Trash2, UploadCloud, Video, Wand2, X } from "lucide-react";
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
  GeneratorGroup,
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
import ManjuStudioLayout from "./ManjuStudioLayout";
import FloatingToolbar from "./FloatingToolbar";
import VideoSegmentGenerator from "./VideoSegmentGenerator";
import BatchPreflightPanel from "./BatchPreflightPanel";
import ManjuCanvas, { type CanvasAssetDropPayload, type CanvasConnection, type CanvasNode } from "./ManjuCanvas";
import { copyDirectorBlockToShots, createDefaultDirectorBlock, findDirectorBlockForShot, getSceneAssetForShot, injectDirectorBlockToPrompt } from "./directorBlock";
import {
  ASSET_KIND_LABELS,
  buildGeneratorGroupSummaryPrompt,
  buildSemanticAssetImagePrompt,
  buildStoryboardSketchPrompt,
  buildStructuredShotImagePrompt,
  buildWorkflowSystemPrompt,
} from "./seedreamPrompts";

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


const TAB_VALUES: Tab[] = ["workflow", "image", "video"];
const WORKFLOW_MODE_VALUES: WorkflowMode[] = ["script", "assets", "storyboardVideo", "storyboardImage"];

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
  const tabParam = searchParams.get("tab");
  const modeParam = searchParams.get("mode");

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

    // 资产节点
    semanticAssets.forEach((asset, i) => {
      const pos = positionMap.get(asset.id);
      nodes.push({
        id: asset.id,
        type: "assets",
        title: asset.name || "未命名资产",
        x: pos?.x ?? assetShelfPosition(i).x,
        y: pos?.y ?? assetShelfPosition(i).y,
        width: 360,
        height: 440,
        data: { asset, kind: asset.kind },
        status: asset.imageUrl || asset.imageAssetId ? "done" : "empty",
      });
    });

    // 镜头卡固定为 shot；分镜图直接显示在镜头卡内部预览区，避免额外节点挤压画布。
    // 视频是更重的产物，作为镜头卡右侧的稳定派生节点展示，避免切参数时被同步清掉。
    storyboardShots.forEach((shot, i) => {
      const hasImage = shot.imageAssetIds && shot.imageAssetIds.length > 0;
      const hasVideo = shot.videoAssetIds && shot.videoAssetIds.length > 0;
      const videoNodeState = videoNodeStates[shot.id];
      const hasActiveVideoNode = hasVideo || videoNodeState?.status === "generating" || videoNodeState?.status === "error";
      const firstImageAssetId = shot.imageAssetIds?.[0];
      const firstVideoAssetId = shot.videoAssetIds?.[0];
      const resolvedShotImageUrl = firstImageAssetId ? storedAssetUrlById.get(firstImageAssetId) : undefined;
      const resolvedShotVideoUrl = firstVideoAssetId ? storedAssetUrlById.get(firstVideoAssetId) : undefined;
      const shotPos = positionMap.get(shot.id);
      nodes.push({
        id: shot.id,
        type: "shot",
        title: `${i + 1}. ${shot.title || shot.scene || "未命名镜头"}`,
        x: shotPos?.x ?? storyboardGridPosition(i).x,
        y: shotPos?.y ?? storyboardGridPosition(i).y,
        width: 360,
        height: 420,
        data: { ...shot, imageUrl: resolvedShotImageUrl, videoUrl: resolvedShotVideoUrl },
        status: shot.status === "image_generating" ? "generating" : hasImage ? "done" : shot.status === "failed" ? "error" : "draft",
      });

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
          data: { ...shot, sourceShotId: shot.id, imageUrl: resolvedShotImageUrl, videoUrl: resolvedShotVideoUrl, errorMessage: videoNodeState?.status === "error" ? getSeedreamVideoErrorMessage(videoNodeState?.errorMessage) : undefined },
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
        y: pos?.y ?? storyboardGridPosition(Math.max(storyboardShots.length, 1)).y + 120,
        width: 420,
        height: 280,
        data: { shotCount: storyboardShots.length },
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
        y: pos?.y ?? storyboardGridPosition(Math.max(storyboardShots.length, 1)).y + 120 + Math.floor(i / 3) * 380,
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
          const sourceShotId = typeof node.data?.sourceShotId === "string" ? node.data.sourceShotId : undefined;
          const sourceShot = sourceShotId ? storyboardShots.find((shot) => shot.id === sourceShotId) : undefined;
          if (!sourceShot) return node;
          const videoNodeState = videoNodeStates[sourceShot.id];
          const sourceImageAssetId = sourceShot.imageAssetIds?.[0];
          const sourceVideoAssetId = sourceShot.videoAssetIds?.[0];
          const sourceImageUrl = sourceImageAssetId ? storedAssetUrlById.get(sourceImageAssetId) : undefined;
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
              imageUrl: sourceImageUrl || node.data?.imageUrl,
              videoUrl: sourceVideoUrl || node.data?.videoUrl,
              errorMessage: node.type === "video" && videoNodeState?.status === "error" ? getSeedreamVideoErrorMessage(videoNodeState?.errorMessage) : node.data?.errorMessage,
            },
          };
        });
      const mergedNodes = [...nodes, ...manualStudioNodes];
      const nextNodes = hasCongestedShotLayout(mergedNodes) ? layoutStudioNodes(mergedNodes) : mergedNodes;
      return canvasNodesSignature(currentNodes) === canvasNodesSignature(nextNodes) ? currentNodes : nextNodes;
    });

    // 自动连线：按场景 + 索引顺序
    const conns: CanvasConnection[] = [];
    const sorted = [...storyboardShots].sort((a, b) => a.index - b.index);
    const scriptNodeExists = Boolean(workflowScript?.trim());
    const shotNodeIds = sorted.map((shot) => shot.id);
    const directorNodeExists = directorBlocks.length > 0;

    if (scriptNodeExists && shotNodeIds[0]) {
      conns.push({ id: `ctx-script-${shotNodeIds[0]}`, from: "script-main", to: shotNodeIds[0], label: "生成分镜", type: "context" });
    }


    sorted.forEach((shot) => {
      const videoNodeState = videoNodeStates[shot.id];
      const hasVideoNode = (shot.videoAssetIds && shot.videoAssetIds.length > 0) || videoNodeState?.status === "generating" || videoNodeState?.status === "error";
      if (hasVideoNode) {
        conns.push({ id: `gen-video-${shot.id}`, from: shot.id, to: `video-node-${shot.id}`, label: "生成视频", type: "generator" });
      }
    });

    if (directorNodeExists && shotNodeIds.length > 0) {
      conns.push({ id: `ctx-${shotNodeIds[shotNodeIds.length - 1]}-director-main`, from: shotNodeIds[shotNodeIds.length - 1], to: "director-main", label: "导演调度", type: "context" });
    }
    generatorGroups.forEach((group) => {
      group.shotIds.forEach((shotId) => {
        conns.push({
          id: `gen-${shotId}-${group.id}`,
          from: shotId,
          to: group.id,
          label: group.mode === "image" ? "生图" : "生视频",
          type: "generator",
        });
      });
    });
    // 多镜头故事板默认不画每一条顺序线：编号已经表达顺序，满屏转场线会让画布显得堆积。
    if (sorted.length <= 4) {
      for (let i = 0; i < sorted.length - 1; i++) {
        const curr = sorted[i];
        const next = sorted[i + 1];
        const isTransition = curr.scene !== next.scene;
        conns.push({
          id: `conn-${curr.id}-${next.id}`,
          from: curr.id,
          to: next.id,
          label: isTransition ? "转场" : undefined,
          type: isTransition ? "scene-transition" : "sequence",
        });
      }
    }
    setStudioConnections((currentConnections) => {
      const autoIds = new Set(conns.map((connection) => connection.id));
      const manualConnections = currentConnections.filter((connection) => !autoIds.has(connection.id) && connection.id.startsWith("manual-"));
      const nextConnections = [...manualConnections, ...conns];
      return canvasConnectionsSignature(currentConnections) === canvasConnectionsSignature(nextConnections) ? currentConnections : nextConnections;
    });
  }, [workflowScript, semanticAssets, storyboardShots, directorBlocks.length, generatorGroups, videoNodeStates, storedAssetUrlById]);

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
    const parsedShots = parseStoryboardShots(nextText, videoModel);
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
          generationActions: shot.generationActions || existing.generationActions,
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

  const handleImportScriptAndShotsFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const clean = stripWorkflowText(String(reader.result || ""));
      if (!clean) {
        toast.error("导入内容为空");
        return;
      }
      setWorkflowScript(clean);
      setScriptSourceExcerpt((prev) => prev || clean.slice(0, 2000));
      const parsedShots = parseStoryboardShots(clean, videoModel);
      if (parsedShots.length) {
        setStoryboardShots(parsedShots);
        setActiveShotId(parsedShots[0]?.id);
        setWorkflowStoryboardVideo(clean);
        setWorkflowMode("storyboardImage");
        setWorkflowView("step");
        toast.success(`剧本已上传，并解析为 ${parsedShots.length} 张镜头卡`);
      } else {
        setWorkflowMode("script");
        setWorkflowView("step");
        toast.success(`剧本已上传，约 ${clean.length} 字，可继续拆成镜头卡`);
      }
    };
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
    setGeneratorGroups(activeProject.generatorGroups || []);
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
      generatorGroups,
      updatedAt: new Date().toISOString(),
    } : project));
  }, [activeProject?.id, loadedProjectId, workflowIdea, workflowNovel, scriptSourceExcerpt, scriptAdaptationInstruction, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, assets, selectedAssetIds, imagePrompt, videoPrompt, storyboardShots, activeShotId, generationJobs, semanticAssets, directorBlocks, generatorGroups]);



  useEffect(() => {
    const succeededImages = images.filter((image) => image.image_url && (image.status === "succeeded" || image.status === "completed"));
    const failedImages = images.filter((image) => image.status === "failed");
    if (!succeededImages.length && !failedImages.length) return;
    setGenerationJobs((prev) => prev.map((job) => {
      if (job.type !== "image" || job.status !== "pending") return job;
      const failedImage = failedImages.find((item) => item.id === job.mediaId);
      if (failedImage) {
        if (job.shotId) updateShot(job.shotId, { status: "failed" });
        return { ...job, status: "failed", updatedAt: new Date().toISOString() };
      }
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
            ? {
                ...item,
                linkedAssetIds: Array.from(new Set([...(item.linkedAssetIds || []), assetIdToLink])),
                imageAssetId: assetIdToLink,
                imageUrl: asset.url,
              }
            : item));
        }
      }
      return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    }));
  }, [images, storyboardShots, semanticAssets, assets]);

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
        if (parsedAssets.length > 0) {
          setSemanticAssets(parsedAssets);
          setActiveSemanticAssetId((prev) => prev || parsedAssets[0]?.id);
        }
      }
      if (mode === "storyboardVideo" || mode === "storyboardImage") {
        const parsedShots = parseStoryboardShots(clean, videoModel);
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
              generationActions: shot.generationActions || prev[index]?.generationActions,
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
    const shot = createShot(storyboardShots.length + 1);
    setStoryboardShots((prev) => [...prev, shot]);
    setActiveShotId(shot.id);
  };

  const deleteShot = (id: string) => {
    setStoryboardShots((prev) => prev.filter((shot) => shot.id !== id).map((shot, index) => ({ ...shot, index: index + 1 })));
    if (activeShotId === id) setActiveShotId(storyboardShots.find((shot) => shot.id !== id)?.id);
  };

  const rebuildShotsFromOutputs = () => {
    const parsed = parseStoryboardShots(workflowStoryboardImage.trim() || workflowStoryboardVideo.trim(), videoModel);
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
    const existingAsset = semanticAssets.find((asset) => asset.id === nodeId);
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
    markStudioVideoProgress(shot.id, "generating");
    const refs = getShotAssets(shot, assets);
    const imageAssets = refs.filter((asset) => asset.type === "image" && !isStoryboardSketchAsset(asset) && VIDEO_REFERENCE_ROLES.has(asset.role || "reference_image"));
    const videoAssets = refs.filter((asset) => asset.type === "video");
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: shot.aspectRatio || videoAspect,
        duration: normalizeVideoDuration(shot.duration || videoDuration, videoModel),
        resolution: normalizeVideoResolution(videoResolution, videoModel),
        generate_audio: videoAudio,
        watermark: false,
        reference_image_urls: imageAssets.map((asset) => asset.url || asset.publicId).filter(Boolean),
        reference_image_roles: imageAssets.map((asset) => (asset.id === shot.firstFrameAssetId ? "first_frame" : asset.id === shot.lastFrameAssetId ? "last_frame" : asset.role === "first_frame" || asset.role === "last_frame" ? asset.role : "reference_image") as "reference_image" | "first_frame" | "last_frame"),
        reference_video_urls: videoAssets.map((asset) => asset.publicId || asset.url),
      });
      setLastVideoId(data.id);
      addGenerationJob({ id: `job-video-${data.id}-${Date.now()}`, shotId: shot.id, type: "video", mediaId: data.id, prompt, status: "pending", entryPath, promptSource: shot.videoPrompt.trim() ? "videoPrompt" : "imagePromptFallback", directorInjected: Boolean(findDirectorBlockForShot(directorBlocks, shot.id)), referenceImageCount: imageAssets.length, referenceVideoCount: videoAssets.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
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
    try {
      const data = await generateVideo({
        prompt,
        model: videoModel,
        ratio: videoAspect,
        duration: normalizeVideoDuration(videoDuration, videoModel),
        resolution: normalizeVideoResolution(videoResolution, videoModel),
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
    const newNode: CanvasNode = {
      id,
      type,
      title: type === "script" ? "新剧本" : type === "assets" ? "未命名资产" : type === "shot" ? "新镜头" : type === "image" ? "新分镜图" : type === "video" ? "新视频" : type === "director" ? "3D导演台" : "新节点",
      x,
      y,
      width: type === "script" || type === "director" ? 420 : 360,
      height: type === "script" || type === "director" ? 300 : type === "assets" ? 440 : 420,
      status: "empty",
      data: sourceShotId && (type === "video" || type === "image") ? {
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
      const label = sourceNode?.type === "assets" || type === "assets" ? "引用" : type === "image" ? "生成分镜" : type === "video" ? "生成视频" : "引用";
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
  }, [addManualStudioConnection, batchLimit, createGeneratorGroupNode, storyboardShots, studioNodes, studioSelectedNodeId]);

  const handleDropAssetToCanvas = useCallback((asset: CanvasAssetDropPayload, x: number, y: number) => {
    const kind = (["character", "scene", "prop", "style"].includes(String(asset.kind)) ? asset.kind : "character") as SemanticAssetKind;
    const existingNode = studioNodes.find((node) => node.id === asset.id);
    if (existingNode) {
      setStudioNodes((prev) => prev.map((node) => node.id === asset.id ? { ...node, x, y } : node));
      setStudioSelectedNodeId(asset.id);
      if (existingNode.type === "assets") {
        setActiveSemanticAssetId(asset.id);
        setWorkflowMode("assets");
        setWorkflowView("step");
      }
      toast.success(`已把「${asset.name || existingNode.title}」放到画布`);
      return;
    }

    const id = semanticAssets.some((item) => item.id === asset.id) ? asset.id : `asset-node-${asset.id}-${Date.now()}`;
    const title = asset.name || "未命名资产";
    const linkedAssetIds = asset.source === "library" ? [asset.id] : [];
    const newSemanticAsset: SemanticAsset = {
      id,
      kind,
      name: title,
      summary: asset.summary || "",
      lockPrompt: asset.summary || "",
      negativePrompt: "",
      linkedAssetIds,
      createdAt: new Date().toISOString(),
      imageUrl: asset.image || undefined,
      imageAssetId: asset.source === "library" ? asset.id : undefined,
    };
    const newNode: CanvasNode = {
      id,
      type: "assets",
      title,
      x,
      y,
      width: 360,
      height: 440,
      status: asset.image || asset.summary ? "draft" : "empty",
      data: {
        kind,
        category: kind,
        summary: asset.summary || "",
        content: asset.summary || "",
        thumbnail: asset.image || "",
        image_url: asset.image || "",
        url: asset.image || "",
        linkedAssetId: asset.id,
        source: asset.source || "library",
      },
    };
    setSemanticAssets((prev) => prev.some((item) => item.id === id) ? prev : [...prev, newSemanticAsset]);
    setStudioNodes((prev) => [...prev, newNode]);
    setStudioSelectedNodeId(id);
    setActiveSemanticAssetId(id);
    setWorkflowMode("assets");
    setWorkflowView("step");
    toast.success(`已从资产库创建「${title}」节点`);
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

  const handleUpdateNodeContent = useCallback((nodeId: string, updates: { title?: string; body?: string }) => {
    if (updates.title !== undefined) {
      setStudioNodes((prev) => prev.map((node) => node.id === nodeId ? { ...node, title: updates.title || "未命名节点" } : node));
      setStoryboardShots((prev) => prev.map((shot) => shot.id === nodeId ? { ...shot, title: updates.title || shot.title } : shot));
      setSemanticAssets((prev) => prev.map((asset) => asset.id === nodeId ? { ...asset, name: updates.title || asset.name } : asset));
      setGeneratorGroups((prev) => prev.map((group) => group.id === nodeId ? { ...group, title: updates.title || group.title } : group));
    }

    if (updates.body !== undefined) {
      const body = updates.body;
      if (nodeId === "script-main") {
        setWorkflowScript(body);
        return;
      }
      const currentNode = studioNodes.find((node) => node.id === nodeId);
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
    const sourceShotId = typeof node?.data?.sourceShotId === "string"
      ? node.data.sourceShotId
      : nodeId.startsWith("image-node-") ? nodeId.replace("image-node-", "") : nodeId.startsWith("video-node-") ? nodeId.replace("video-node-", "") : nodeId;
    const shot = storyboardShots.find((item) => item.id === sourceShotId);
    if (shot) {
      if (node?.type === "video" || (shot.videoPrompt && !shot.imagePrompt)) {
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
  }, [batchGenerateImagesForShots, batchGenerateVideosForShots, generateNodeAssetImage, generateSemanticAssetImage, generateShotImage, generateShotVideo, generatorGroups, semanticAssets, storyboardShots, studioNodes]);

  const handleStudioNodeDoubleClick = useCallback((node: CanvasNode) => {
    setStudioSelectedNodeId(node.id);
    if (node.type === "script") {
      setWorkflowMode("script");
      setWorkflowView("step");
      setActiveShotId(undefined);
      setActiveSemanticAssetId(undefined);
    } else if (node.type === "assets") {
      const asset = semanticAssets.find((a) => a.id === node.id);
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

    if (workflowView === "step" && activeShotId) {
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
              一键生成资产
            </button>
          </div>
          <div className="space-y-3">
            {semanticAssets.length === 0 && (
              <div className="rounded-lg border border-dashed border-surface-border p-4 text-center text-xs text-text-tertiary">
                暂无资产，点击上方按钮或画布 + 号添加
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
                <textarea
                  value={asset.lockPrompt}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSemanticAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, lockPrompt: value } : a)));
                  }}
                  placeholder="lock_prompt..."
                  className="h-16 w-full rounded border border-surface-border bg-surface-elevated p-1.5 text-[10px] text-text-secondary outline-none focus:border-brand"
                />
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
      return (
        <div className="space-y-3">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">{isImage ? "分镜图提示词" : "分镜剧本/视频提示词"}</h3>
          <div className="space-y-3">
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={isImage ? "输入分镜图提示词..." : "输入分镜剧本或 Seedance 视频提示词..."}
              className="h-56 w-full rounded-lg border border-surface-border bg-surface-base p-2 text-[11px] leading-relaxed text-text-secondary outline-none focus:border-brand"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => generateWorkflow(workflowMode)}
                disabled={Boolean(workflowGenerating)}
                className="flex items-center justify-center gap-1 rounded-lg bg-brand/10 py-2 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                {workflowGenerating === workflowMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                一键生成
              </button>
              <button
                type="button"
                onClick={() => mergeStoryboardShots(raw, isImage ? "storyboard" : "seedance")}
                disabled={!raw.trim()}
                className="flex items-center justify-center gap-1 rounded-lg bg-surface-card py-2 text-[11px] font-medium text-text-primary hover:bg-surface-border disabled:opacity-50"
              >
                <Layers className="h-3.5 w-3.5" />
                解析为镜头卡
              </button>
            </div>
            <div className="rounded-lg bg-surface-card p-3 text-[10px] text-text-secondary">
              <p className="mb-1 font-medium text-text-primary">快捷操作</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>双击画布镜头节点可编辑单个镜头</li>
                <li>点击左侧步骤可切换到剧本/资产</li>
                <li>生成后点击解析，系统会自动创建镜头卡</li>
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
  }, [activeProject, workflowIdea, workflowNovel, scriptSourceExcerpt, scriptAdaptationInstruction, workflowScript, workflowAssets, workflowStoryboardVideo, workflowStoryboardImage, assets, selectedAssetIds, imagePrompt, videoPrompt, storyboardShots, activeShotId, generationJobs, semanticAssets, directorBlocks, generatorGroups, setProjects]);

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
        composerGenerating={isGenerating || videoGenerating || Boolean(batchGenerating) || Boolean(assetImageGeneratingId)}
        onAutoLayout={autoLayoutNodes}
        onBatchGenerate={(nodeIds, mode) => createGeneratorGroupNode(nodeIds, mode)}
        onConnectNodes={handleCanvasConnectNodes}
        onDropAsset={handleDropAssetToCanvas}
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
      >
        <FloatingToolbar
          onAddNode={handleStudioAddNode}
          onHelp={() => toast.info("画布操作：滚轮缩放、拖拽移动、双击节点编辑")}
        />
      </ManjuStudioLayout>
    </div>
  );
}