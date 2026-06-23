"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, Image, Loader2, MessageSquare, Send, Sparkles, Type, Video, WandSparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNode } from "./ManjuCanvas";

type ComposerMode = "text" | "image" | "video" | "asset" | "generator";

export type ComposerSettings = {
  imageAspect: string;
  imageResolution: string;
  assetPreset: "character" | "characterTurnaround" | "asset";
  videoModel: string;
  videoAspect: string;
  videoResolution: string;
  videoDuration: number;
  videoAudio: boolean;
};

export interface BottomNodeComposerProps {
  node: CanvasNode | null;
  mentionAssets?: Array<{ id: string; name: string; kind?: string; category?: string; summary?: string; imageUrl?: string; image_url?: string; url?: string }>;
  settings: ComposerSettings;
  options: {
    imageAspects: string[];
    imageResolutions: string[];
    videoModels: string[];
    videoAspects: string[];
    videoResolutions: string[];
    videoDurations: number[];
  };
  generating?: boolean;
  onUpdate?: (nodeId: string, updates: { title?: string; body?: string }) => void;
  onSettingsChange?: (nodeId: string, updates: Partial<ComposerSettings>) => void;
  onBindAssetMention?: (nodeId: string, assetId: string) => void;
  onGenerate?: (nodeId: string) => void;
  onRewriteAsset?: (nodeId: string, instruction: string) => void;
  onChatAsset?: (nodeId: string, question: string) => void;
  assetRewriting?: boolean;
  assetChatting?: boolean;
  onClose?: () => void;
  variant?: "fixed" | "attached";
}

// 模板提示词过滤在 readNodeBody 中惰性调用，实际初始化在 IMAGE_TEMPLATE_GROUPS 定义之后

function readNodeBody(node: CanvasNode) {
  const data = (node.data || {}) as Record<string, unknown>;
  const asset = data.asset as Record<string, unknown> | undefined;
  if (node.type === "script") return String(data.content || "");
  if (node.type === "assets") {
    const raw = String(asset?.summary || data.summary || asset?.lockPrompt || data.lockPrompt || "");
    // 如果 summary 被旧逻辑写成了模板提示词，视为空，让用户看到真实的资产描述或空占位
    return getTemplatePromptValues().has(raw) ? "" : raw;
  }
  if (node.type === "video") return String(data.videoPrompt || data.imagePrompt || "");
  if (node.type === "generator") return String(data.promptPreview || "");
  if (node.type === "shot" || node.type === "image") return String(data.imagePrompt || data.scene || "");
  return String(data.content || data.scene || "");
}

function modeOf(node: CanvasNode): ComposerMode {
  if (node.type === "assets") return "asset";
  if (node.type === "video") return "video";
  if (node.type === "generator") return "generator";
  if (node.type === "image" || node.type === "shot") return "image";
  return "text";
}

function modeLabel(mode: ComposerMode, node?: CanvasNode) {
  if (mode === "asset") return "资产描述";
  if (mode === "image") return node?.data?.sourceShotId ? "分镜图提示词" : "图片提示词";
  if (mode === "video") return "视频提示词";
  if (mode === "generator") return "生成器组";
  return "剧本/文本";
}

function modeIcon(mode: ComposerMode) {
  if (mode === "asset") return <Box className="h-3.5 w-3.5" />;
  if (mode === "image") return <Image className="h-3.5 w-3.5" />;
  if (mode === "video") return <Video className="h-3.5 w-3.5" />;
  if (mode === "generator") return <WandSparkles className="h-3.5 w-3.5" />;
  return <Type className="h-3.5 w-3.5" />;
}

const IMAGE_TEMPLATE_GROUPS = [
  {
    title: "分镜叙事",
    items: [
      { label: "故事板", value: "生成故事板分镜图，按剧情顺序呈现关键画面，镜头关系清晰，叙事连续，画面统一。" },
      { label: "25宫格连贯分镜", value: "生成25宫格连贯分镜，连续展示动作与剧情推进，每格构图清晰，角色一致，场景衔接稳定。" },
      { label: "剧情推演四宫格", value: "生成剧情推演四宫格，展示当前画面前后关键剧情变化，四格连续，人物和场景保持一致。" },
      { label: "画面推演 - 3秒后", value: "基于当前画面推演3秒后的画面，保持角色、场景、光影一致，动作自然延续。" },
      { label: "画面推演 - 5秒前", value: "基于当前画面反向推演5秒前的画面，保持角色、场景、光影一致，动作来源合理。" },
    ],
  },
  {
    title: "空间与机位",
    items: [
      { label: "720全景", value: "基于当前画面生成720全景空间设定，补全周围环境，空间连续，光源和风格一致。" },
      { label: "多机位九宫格", value: "基于当前画面生成多机位九宫格，同一场景不同机位展示，角色位置和空间关系一致。" },
    ],
  },
  {
    title: "质感调节",
    items: [
      { label: "电影级光影校正", value: "对当前画面进行电影级光影校正，保持构图和主体不变，增强光影层次、色彩质感和画面统一性。" },
    ],
  },
  {
    title: "设定图",
    items: [
      { label: "角色脸部三视图", value: "基于参考图生成角色脸部三视图，正脸、侧脸、三分之二角度，五官一致，白底设定稿。" },
      { label: "角色设定图", value: "基于参考图生成角色设定图，保持同一角色一致性，展示完整人物形象、服装、发型、随身物，白底设定稿。" },
      { label: "角色三视图", value: "基于参考图生成角色三视图，白底设定稿，同一角色一致性，正面、侧面、背面并排展示，服装和发型保持一致，清晰完整。", description: "一键生成角色三视图（正面/侧面/背面）。" },
      { label: "场景设定图", value: "生成场景设定图，展示空间结构、光源、材质、时代氛围和关键陈设，画面清晰完整。" },
      { label: "产品设定图", value: "生成产品设定图，展示产品正面、侧面、细节结构和材质，白底清晰，比例准确。" },
    ],
  },
];

// 惰性初始化：收集所有模板提示词文本，用于过滤被旧逻辑误写入资产 summary 的模板污染
let _templatePromptValues: Set<string> | null = null;
function getTemplatePromptValues() {
  if (!_templatePromptValues) {
    _templatePromptValues = new Set(IMAGE_TEMPLATE_GROUPS.flatMap((group) => group.items.map((item) => item.value)));
  }
  return _templatePromptValues;
}

function mentionMeta(kind?: string) {
  if (kind === "character") return "角色";
  if (kind === "scene") return "场景";
  if (kind === "prop") return "道具";
  if (kind === "style") return "风格";
  return kind || "资产";
}

function SelectPill({ value, options, onChange, className, formatLabel }: { value: string; options: string[]; onChange: (value: string) => void; className?: string; formatLabel?: (value: string) => string }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn("h-7 rounded-full border border-slate-300 bg-white px-2.5 text-[10px] font-semibold text-slate-800 shadow-sm outline-none hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-200", className)}
    >
      {options.map((option) => <option key={option} value={option} className="bg-white text-slate-900">{formatLabel ? formatLabel(option) : option}</option>)}
    </select>
  );
}

function BottomNodeComposerInner({ node, mentionAssets = [], settings, options, generating, onUpdate, onSettingsChange, onBindAssetMention, onGenerate, onRewriteAsset, onChatAsset, assetRewriting, assetChatting, onClose, variant = "fixed" }: BottomNodeComposerProps & { node: CanvasNode }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [assetAiInput, setAssetAiInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTemplateLabel, setSelectedTemplateLabel] = useState("角色设定图");

  const mode = modeOf(node);
  const data = (node.data || {}) as Record<string, unknown>;
  const asset = data.asset as Record<string, unknown> | undefined;
  const assetKind = String(data.kind || data.category || asset?.kind || "asset");
  const isCharacter = assetKind === "character" || assetKind === "角色";
  const groupMode = data.mode === "video" ? "video" : "image";
  const effectiveMode = mode === "generator" ? groupMode : mode;
  const referenceImageUrl = String(data.referenceImageUrl || "") || (() => {
    const referenceAssetId = String(data.referenceAssetId || "");
    if (!referenceAssetId) return "";
    const ref = mentionAssets.find((asset) => asset.id === referenceAssetId);
    return ref?.imageUrl || ref?.image_url || ref?.url || "";
  })();
  const body = readNodeBody(node);
  const mentionSuggestions = useMemo(() => {
    const query = (mentionQuery || "").trim().toLowerCase();
    return mentionAssets
      .filter((asset) => {
        if (!query) return true;
        return [asset.name, asset.kind, asset.category, asset.summary].filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [mentionAssets, mentionQuery]);

  useEffect(() => {
    setTitleDraft(node.title);
    setBodyDraft(body);
    setMentionQuery(null);
    setAssetAiInput("");
    composingRef.current = false;
    // 切换节点时重置模板选中标签，避免上一个节点的模板选择残留
    setSelectedTemplateLabel(isCharacter ? "角色设定图" : "资产描述");
  }, [node.id, node.title, body, isCharacter]);

  const commitBody = (value = bodyDraft) => {
    onUpdate?.(node.id, { body: value });
  };

  const updateMentionQuery = (value: string, caret = textareaRef.current?.selectionStart || value.length) => {
    const beforeCaret = value.slice(0, caret);
    const match = beforeCaret.match(/(^|[\s，。；：、\n])@([^@\s，。；：、]*)$/);
    setMentionQuery(match ? match[2] : null);
  };

  const insertMentionAsset = (asset: { id: string; name: string }) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? bodyDraft.length;
    const before = bodyDraft.slice(0, caret);
    const after = bodyDraft.slice(caret);
    const match = before.match(/(^|[\s，。；：、\n])@([^@\s，。；：、]*)$/);
    const prefix = match ? before.slice(0, before.length - match[0].length) + match[1] : before;
    const next = `${prefix}@${asset.name} ${after}`;
    const nextCaret = `${prefix}@${asset.name} `.length;
    setBodyDraft(next);
    setMentionQuery(null);
    onBindAssetMention?.(node.id, asset.id);
    onUpdate?.(node.id, { body: next });
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  const placeholder = mode === "asset"
    ? isCharacter
      ? "描述角色固定外貌、服饰、发型、气质与基础形象；默认生成角色设定图"
      : "描述资产外观、材质、环境约束；可直接生成资产图"
    : effectiveMode === "video"
      ? "输入 Seedance 视频提示词：动作、镜头、首尾帧衔接、时长节奏"
      : mode === "generator"
        ? "本组批量生成说明；镜头拖线到生成器组后统一预检提交"
        : effectiveMode === "image"
          ? "输入 Seedream 图片指令：如“基于参考图生成角色三视图，白底，正面/侧面/背面”"
          : "输入小说/剧本/创意文本，可配合一键写小说或一键改剧本";
  const canGenerate = mode !== "text";
  const attached = variant === "attached";

  const applyQuickPrompt = (label: string, value: string) => {
    setSelectedTemplateLabel(label);
    setBodyDraft(value);
    // 模板切换时同步 assetPreset
    if (label === "角色三视图") {
      onSettingsChange?.(node.id, { assetPreset: "characterTurnaround" });
    } else if (label === "角色设定图") {
      onSettingsChange?.(node.id, { assetPreset: "character" });
    }
    setTemplateMenuOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const generateLabel = mode === "asset" && isCharacter
    ? (settings.assetPreset === "characterTurnaround" ? "生成三视图" : "生成角色图")
    : mode === "generator"
      ? "批量提交"
      : effectiveMode === "video"
        ? "生成视频"
        : effectiveMode === "image"
          ? (node.data?.sourceShotId ? "生成分镜图" : "生成图片")
          : "保存";

  return (
    <div className={cn(attached ? "nodrag nowheel pointer-events-auto relative left-1/2 z-50 mt-4 w-[min(860px,80vw)] max-w-none -translate-x-1/2" : "pointer-events-none absolute inset-x-0 bottom-5 z-50 flex justify-center px-4")}>
      <div
        data-seedream-composer="true"
        className={cn(
          "pointer-events-auto relative overflow-visible border border-white/10 bg-[#111319] text-white shadow-[0_18px_55px_rgba(0,0,0,0.38)] ring-1 ring-white/5",
          attached ? "w-full rounded-[30px]" : "w-[min(1120px,calc(100%-32px))] rounded-[32px]"
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
          <button
            type="button"
            onClick={() => setTemplateMenuOpen((value) => !value)}
            className="flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15"
          >
            {modeIcon(mode)}
            {modeLabel(mode, node)}
            <ChevronDown className="h-3 w-3 text-white/55" />
          </button>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => onUpdate?.(node.id, { title: titleDraft })}
            onKeyDown={(event) => {
              if ((event.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") onUpdate?.(node.id, { title: titleDraft });
            }}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-[14px] font-semibold text-white outline-none placeholder:text-white/35 focus:border-blue-400/70 focus:bg-white/[0.09]"
            placeholder="节点标题"
          />
          {mode === "asset" && isCharacter && (
            <span className="rounded-full bg-blue-500/15 px-3 py-1.5 text-[11px] font-semibold text-blue-200">
              {settings.assetPreset === "characterTurnaround" ? "三视图" : "角色图"}
            </span>
          )}
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose?.();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭节点编辑器"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {templateMenuOpen && (effectiveMode === "image" || mode === "asset") && (
          <div className="absolute bottom-[calc(100%-10px)] left-6 z-[70] grid w-[min(760px,calc(100vw-64px))] grid-cols-[1.25fr_0.95fr_1.2fr] gap-3 overflow-hidden rounded-3xl border border-white/10 bg-[#171a22] p-4 shadow-2xl ring-1 ring-black/30">
            {IMAGE_TEMPLATE_GROUPS.map((group) => (
              <div key={group.title} className="min-w-0">
                <div className="mb-2 px-2 text-[11px] font-semibold text-white/45">{group.title}</div>
                <div className="grid gap-1">
                  {group.items.map((item) => {
                    const selected = selectedTemplateLabel === item.label;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          if (mode === "asset" && item.label === "角色三视图") {
                            onSettingsChange?.(node.id, { assetPreset: "characterTurnaround" });
                          }
                          if (mode === "asset" && item.label === "角色设定图") {
                            onSettingsChange?.(node.id, { assetPreset: "character" });
                          }
                          applyQuickPrompt(item.label, item.value);
                        }}
                        className={cn("group rounded-2xl px-3 py-2.5 text-left hover:bg-white/10", selected && "bg-white/15")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-bold text-white">{item.label}</span>
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                        </div>
                        {item.description && <div className="mt-1 line-clamp-2 text-[10px] text-white/45 group-hover:text-white/65">{item.description}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {mentionQuery !== null && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-[calc(100%-8px)] left-6 z-[80] w-[min(360px,calc(100%-48px))] overflow-hidden rounded-2xl border border-white/10 bg-[#171a22] shadow-2xl ring-1 ring-black/30">
            <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold text-white/50">绑定资产到当前节点</div>
            <div className="max-h-56 overflow-auto p-1.5">
              {mentionSuggestions.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMentionAsset(asset)}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-white/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[10px] font-bold text-white/60">
                    {mentionMeta(asset.kind || asset.category).slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-white">@{asset.name}</span>
                    <span className="block truncate text-[10px] text-white/45">{mentionMeta(asset.kind || asset.category)} · {asset.summary || "点击后写入提示词并绑定引用"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-5">
          {referenceImageUrl && effectiveMode === "image" && mode !== "asset" && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-[12px] text-white/55">
              <img src={referenceImageUrl} alt="参考图" className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/10" />
              <span className="truncate">参考上游图片；当前节点结果为空，生成后才写入。</span>
            </div>
          )}
          <div className="rounded-[28px] border border-white/10 bg-[#0d0f14] p-3 shadow-inner">
            <textarea
              ref={textareaRef}
              value={bodyDraft}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                const value = event.currentTarget.value;
                setBodyDraft(value);
                updateMentionQuery(value, event.currentTarget.selectionStart);
                onUpdate?.(node.id, { body: value });
              }}
              onChange={(event) => {
                const value = event.target.value;
                setBodyDraft(value);
                updateMentionQuery(value, event.target.selectionStart);
                if (!composingRef.current) onUpdate?.(node.id, { body: value });
              }}
              onBlur={() => commitBody()}
              onKeyDown={(event) => {
                if ((event.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing || event.keyCode === 229) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setMentionQuery(null);
                  setTemplateMenuOpen(false);
                  setSettingsOpen(false);
                  onClose?.();
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate && !generating) {
                  event.preventDefault();
                  onGenerate?.(node.id);
                }
              }}
              onSelect={(event) => updateMentionQuery(bodyDraft, event.currentTarget.selectionStart)}
              placeholder={placeholder}
              className="h-40 w-full resize-none border-0 bg-transparent px-4 py-3 text-[15px] leading-7 text-white outline-none placeholder:text-white/32"
            />
            <div className="flex flex-wrap items-center gap-3 border-t border-white/8 px-2 pt-3">
              <button
                type="button"
                onClick={() => setTemplateMenuOpen((value) => !value)}
                className={cn("flex h-10 items-center gap-2 rounded-full border px-4 text-[12px] font-bold", templateMenuOpen ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/10")}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {selectedTemplateLabel}
                <ChevronDown className="h-3 w-3" />
              </button>
              {(effectiveMode === "image" || mode === "asset") && (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen((value) => !value)}
                    className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[12px] font-bold text-white/70 hover:bg-white/10"
                  >
                    Seedream · {settings.imageAspect} · {settings.imageResolution}
                    <ChevronDown className="h-3 w-3" />
                  </button>
              )}
              {effectiveMode === "video" && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen((value) => !value)}
                  className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[12px] font-bold text-white/70 hover:bg-white/10"
                >
                  {settings.videoModel} · {settings.videoDuration === -1 ? "自动" : `${settings.videoDuration}s`}
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
              <div className="min-w-0 flex-1" />
              <button
                type="button"
                disabled={!canGenerate || generating}
                onClick={() => onGenerate?.(node.id)}
                className="flex h-12 items-center gap-2 rounded-full bg-blue-500 px-6 text-[14px] font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {generateLabel}
              </button>
            </div>
          </div>

          {settingsOpen && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-[12px] text-white/60">
              {(effectiveMode === "image" || mode === "asset") && (
                <>
                  <span className="rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white/80">Seedream</span>
                  <SelectPill value={settings.imageAspect} options={options.imageAspects} onChange={(value) => onSettingsChange?.(node.id, { imageAspect: value })} className="border-white/10 bg-[#171a22] text-white" />
                  <SelectPill value={settings.imageResolution} options={options.imageResolutions} onChange={(value) => onSettingsChange?.(node.id, { imageResolution: value })} className="border-white/10 bg-[#171a22] text-white" />
                </>
              )}
              {effectiveMode === "video" && (
                <>
                  <SelectPill value={settings.videoModel} options={options.videoModels} onChange={(value) => onSettingsChange?.(node.id, { videoModel: value })} className="max-w-64 border-white/10 bg-[#171a22] text-white" />
                  <SelectPill value={settings.videoAspect} options={options.videoAspects} onChange={(value) => onSettingsChange?.(node.id, { videoAspect: value })} className="border-white/10 bg-[#171a22] text-white" />
                  <SelectPill value={settings.videoResolution} options={options.videoResolutions} onChange={(value) => onSettingsChange?.(node.id, { videoResolution: value })} className="border-white/10 bg-[#171a22] text-white" />
                  <SelectPill value={String(settings.videoDuration)} options={options.videoDurations.map(String)} onChange={(value) => onSettingsChange?.(node.id, { videoDuration: Number(value) })} formatLabel={(value) => value === "-1" ? "自动" : `${value}s`} className="border-white/10 bg-[#171a22] text-white" />
                  <button
                    type="button"
                    onClick={() => onSettingsChange?.(node.id, { videoAudio: !settings.videoAudio })}
                    className={cn("h-8 rounded-full border px-3 text-[11px] font-semibold", settings.videoAudio ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.06] text-white/70")}
                  >
                    {settings.videoAudio ? "音频开" : "音频关"}
                  </button>
                </>
              )}
            </div>
          )}

          {mode === "asset" && (onRewriteAsset || onChatAsset) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <input
                value={assetAiInput}
                onChange={(event) => setAssetAiInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter" && assetAiInput.trim()) {
                    event.preventDefault();
                    onRewriteAsset?.(node.id, assetAiInput.trim());
                  }
                }}
                placeholder="让 AI 修改资产描述，或聊一下当前设定"
                className="h-10 min-w-[280px] flex-1 rounded-full border border-white/10 bg-[#0d0f14] px-4 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-blue-400/70"
              />
              <button
                type="button"
                disabled={!assetAiInput.trim() || assetRewriting}
                onClick={() => onRewriteAsset?.(node.id, assetAiInput.trim())}
                className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[12px] font-bold text-slate-950 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {assetRewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                改写覆盖
              </button>
              <button
                type="button"
                disabled={!assetAiInput.trim() || assetChatting}
                onClick={() => onChatAsset?.(node.id, assetAiInput.trim())}
                className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[12px] font-bold text-white/75 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {assetChatting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                聊一下
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BottomNodeComposer(props: BottomNodeComposerProps) {
  if (!props.node) return null;
  return <BottomNodeComposerInner {...props} node={props.node} />;
}
