"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, Image, Loader2, Send, Sparkles, Type, Video, WandSparkles, X } from "lucide-react";
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
  onClose?: () => void;
  variant?: "fixed" | "attached";
}

function readNodeBody(node: CanvasNode) {
  const data = (node.data || {}) as Record<string, unknown>;
  const asset = data.asset as Record<string, unknown> | undefined;
  if (node.type === "script") return String(data.content || "");
  if (node.type === "assets") return String(asset?.lockPrompt || data.lockPrompt || data.summary || "");
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

function modeLabel(mode: ComposerMode) {
  if (mode === "asset") return "资产提示词";
  if (mode === "image") return "分镜图提示词";
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

function BottomNodeComposerInner({ node, mentionAssets = [], settings, options, generating, onUpdate, onSettingsChange, onBindAssetMention, onGenerate, onClose, variant = "fixed" }: BottomNodeComposerProps & { node: CanvasNode }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const mode = modeOf(node);
  const data = (node.data || {}) as Record<string, unknown>;
  const asset = data.asset as Record<string, unknown> | undefined;
  const assetKind = String(data.kind || data.category || asset?.kind || "asset");
  const isCharacter = assetKind === "character" || assetKind === "角色";
  const groupMode = data.mode === "video" ? "video" : "image";
  const effectiveMode = mode === "generator" ? groupMode : mode;
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
    composingRef.current = false;
  }, [node.id, node.title, body]);

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
          ? "输入 Seedream 分镜图提示词：主体、场景、景别、构图、参考资产"
          : "输入小说/剧本/创意文本，可配合一键写小说或一键改剧本";
  const canGenerate = mode !== "text";
  const attached = variant === "attached";

  return (
    <div className={cn(attached ? "nodrag nowheel pointer-events-auto mt-3 w-full" : "pointer-events-none absolute inset-x-0 bottom-5 z-50 flex justify-center px-4")}>
      <div data-seedream-composer="true" className={cn("pointer-events-auto overflow-hidden border border-slate-300 bg-white text-slate-950 shadow-[0_10px_28px_rgba(15,23,42,0.16)] ring-1 ring-black/8", attached ? "w-full rounded-[22px]" : "w-[min(980px,calc(100%-32px))] rounded-[28px]")}>
        <div className={cn("flex items-center gap-2 border-b border-slate-200 bg-slate-50", attached ? "px-4 py-3" : "px-4 py-3")}>
          <button type="button" className={cn("flex items-center gap-1.5 rounded-full bg-slate-900 font-semibold text-white shadow-sm hover:bg-slate-800", attached ? "h-8 px-3 text-[12px]" : "h-8 px-3 text-[12px]")}>
            {modeIcon(mode)}
            {modeLabel(mode)}
            <ChevronDown className="h-3 w-3 text-white/70" />
          </button>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => onUpdate?.(node.id, { title: titleDraft })}
            onKeyDown={(event) => {
              if ((event.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") onUpdate?.(node.id, { title: titleDraft });
            }}
            className={cn("min-w-0 flex-1 rounded-full border border-slate-300 bg-white font-semibold text-slate-950 shadow-inner outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-100", attached ? "h-8 px-3 text-[13px]" : "px-3 py-2 text-[13px]")}
            placeholder="节点标题"
          />
          <span className={cn("rounded-full font-semibold", attached ? "px-2.5 py-1 text-[10px]" : "px-2.5 py-1 text-[10px]", isCharacter ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600")}>
            {isCharacter ? "角色设定图" : node.type}
          </span>
          <button type="button" onClick={onClose} className={cn("flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900", attached ? "h-8 w-8" : "h-8 w-8")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={cn("relative bg-white", attached ? "px-4 py-3" : "px-4 py-3")}>
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
              if (!composingRef.current) {
                // 英文/符号输入实时提交；中文 IME 组词期间不提交，避免候选字被父状态重置打断。
                onUpdate?.(node.id, { body: value });
              }
            }}
            onBlur={() => commitBody()}
            onKeyDown={(event) => {
              if ((event.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing || event.keyCode === 229) return;
              if (event.key === "Escape") setMentionQuery(null);
            }}
            onSelect={(event) => updateMentionQuery(bodyDraft, event.currentTarget.selectionStart)}
            placeholder={placeholder}
            className={cn("w-full resize-none border border-slate-300 bg-slate-50 text-slate-950 shadow-inner outline-none placeholder:text-slate-500 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100", attached ? "h-32 rounded-[18px] p-4 text-[14px] leading-relaxed" : "h-32 rounded-[18px] p-4 text-[14px] leading-relaxed")}
          />
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-[calc(100%-10px)] left-6 z-50 w-[min(360px,calc(100%-48px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
              <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500">绑定资产到当前镜头</div>
              <div className="max-h-56 overflow-auto p-1.5">
                {mentionSuggestions.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMentionAsset(asset)}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-slate-100"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] font-bold text-slate-500">
                      {mentionMeta(asset.kind || asset.category).slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-slate-900">@{asset.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">{mentionMeta(asset.kind || asset.category)} · {asset.summary || "点击后写入提示词并绑定引用"}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={cn("flex flex-wrap items-center border-t border-slate-200 bg-slate-50 text-slate-600", attached ? "gap-2 px-4 py-3 text-[11px]" : "gap-2 px-4 py-3 text-[11px]")}>
          {(effectiveMode === "image" || mode === "asset") && (
            <>
              <span className={cn("rounded-full bg-slate-900 font-semibold text-white", attached ? "px-3 py-1.5" : "px-3 py-1.5")}>Seedream</span>
              {mode === "asset" && isCharacter && (
                <SelectPill
                  value={settings.assetPreset === "characterTurnaround" ? "角色三视图" : "角色设定图"}
                  options={["角色设定图", "角色三视图"]}
                  onChange={(value) => onSettingsChange?.(node.id, { assetPreset: value === "角色三视图" ? "characterTurnaround" : "character" })}
                />
              )}
              <SelectPill value={settings.imageAspect} options={options.imageAspects} onChange={(value) => onSettingsChange?.(node.id, { imageAspect: value })} />
              <SelectPill value={settings.imageResolution} options={options.imageResolutions} onChange={(value) => onSettingsChange?.(node.id, { imageResolution: value })} />
            </>
          )}
          {effectiveMode === "video" && (
            <>
              <SelectPill value={settings.videoModel} options={options.videoModels} onChange={(value) => onSettingsChange?.(node.id, { videoModel: value })} className="max-w-64" />
              <SelectPill value={settings.videoAspect} options={options.videoAspects} onChange={(value) => onSettingsChange?.(node.id, { videoAspect: value })} />
              <SelectPill value={settings.videoResolution} options={options.videoResolutions} onChange={(value) => onSettingsChange?.(node.id, { videoResolution: value })} />
              <SelectPill value={String(settings.videoDuration)} options={options.videoDurations.map(String)} onChange={(value) => onSettingsChange?.(node.id, { videoDuration: Number(value) })} formatLabel={(value) => value === "-1" ? "自动" : `${value}s`} />
              <button
                type="button"
                onClick={() => onSettingsChange?.(node.id, { videoAudio: !settings.videoAudio })}
                className={cn("h-8 rounded-full border px-3 text-[11px] font-semibold shadow-sm", settings.videoAudio ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}
              >
                {settings.videoAudio ? "音频开" : "音频关"}
              </button>
            </>
          )}
          {mode === "text" && <span className="rounded-full bg-slate-200 px-3 py-1.5 font-semibold text-slate-700">文本节点 · 编辑后同步剧本</span>}
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            disabled={!canGenerate || generating}
            onClick={() => onGenerate?.(node.id)}
            className={cn("flex items-center gap-2 rounded-full bg-slate-950 font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45", attached ? "h-9 px-4 text-[12px]" : "h-9 px-4 text-[12px]")}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {mode === "asset" && isCharacter ? (settings.assetPreset === "characterTurnaround" ? "生成三视图" : "生成角色图") : mode === "generator" ? "批量提交" : effectiveMode === "video" ? "生成视频" : effectiveMode === "image" ? "生成分镜图" : "不可生成"}
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BottomNodeComposer(props: BottomNodeComposerProps) {
  if (!props.node) return null;
  return <BottomNodeComposerInner {...props} node={props.node} />;
}
