"use client";

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useCredits } from "@/hooks/useCredits";
import {
  ArrowLeft,
  Box,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  Search,
  Settings,
  Sparkles,
  TreePine,
  Trash2,
  UploadCloud,
  Users,
  Video,
  X,
} from "lucide-react";
import ManjuCanvas, { type CanvasAssetDropPayload, type CanvasConnection, type CanvasNode } from "./ManjuCanvas";
import type { ComposerSettings } from "./BottomNodeComposer";
import ManjuNodePanel from "./ManjuNodePanel";
import ManjuProjectIO from "./ManjuProjectIO";
import type { WorkflowMode } from "./types";
import { toast } from "sonner";

export interface ManjuStudioLayoutProps {
  projectName: string;
  projectId?: string;

  activeStep: WorkflowMode | "overview";
  onStepChange: (step: WorkflowMode | "overview") => void;
  onGenerate?: (step: WorkflowMode) => void;
  generating?: WorkflowMode | null;

  nodes: CanvasNode[];
  connections?: CanvasConnection[];
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeSelect?: (id: string | null) => void;
  onNodeDoubleClick?: (node: CanvasNode) => void;
  onUpdateNodeContent?: (nodeId: string, updates: { title?: string; body?: string }) => void;
  onAddNode?: (type: CanvasNode["type"], x: number, y: number, sourceNodeId?: string, sourceSide?: "left" | "right") => void;
  onDeleteNode?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  selectedNodeId?: string | null;

  onGenerateAsset?: (assetId: string) => void;
  onAutoLayout?: () => void;
  onBatchGenerate?: (nodeIds: string[], mode: "image" | "video") => void;
  onConnectNodes?: (from: string, to: string) => void;
  onDropAsset?: (asset: CanvasAssetDropPayload, x: number, y: number) => void;
  onDeleteAsset?: (assetId: string, source?: "semantic" | "library") => void;
  onSave?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onImportScriptFile?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSettings?: () => void;

  onNodeUpload?: (nodeId: string) => void;
  onNodeGenerate?: (nodeId: string) => void;
  onNodePickFromLibrary?: (nodeId: string) => void;
  nodeAssets?: Array<{ id: string; publicId?: string; name: string; category?: string; kind?: string; summary?: string; url?: string; image_url?: string }>;
  mentionAssets?: Array<{ id: string; name: string; kind?: string; category?: string; summary?: string; lockPrompt?: string; imageUrl?: string; image_url?: string; url?: string }>;
  composerSettings: ComposerSettings;
  composerOptions: {
    imageAspects: string[];
    imageResolutions: string[];
    videoModels: string[];
    videoAspects: string[];
    videoResolutions: string[];
    videoDurations: number[];
  };
  onComposerSettingsChange?: (nodeId: string, updates: Partial<ComposerSettings>) => void;
  onBindAssetMention?: (nodeId: string, assetId: string) => void;
  onRewriteAsset?: (nodeId: string, instruction: string) => void;
  onChatAsset?: (nodeId: string, question: string) => void;
  assetRewriting?: boolean;
  assetChatting?: boolean;
  composerGenerating?: boolean;
  onGenerateImage?: () => void;
  storyboardShotCount?: number;
  storyboardImageCount?: number;
  storyboardVideoCount?: number;

  children?: React.ReactNode;
  rightPanel?: React.ReactNode;
  storyFlowNav?: React.ReactNode;
}

type StageStatus = "empty" | "draft" | "done";

type Stage = {
  id: WorkflowMode | "overview";
  label: string;
  desc: string;
  status: StageStatus;
  generate?: WorkflowMode;
  activeWhen?: Array<WorkflowMode | "overview">;
};

type StageActionMeta = {
  label: string;
  title: string;
  disabled?: boolean;
  generate?: WorkflowMode;
};

type StudioSurfaceMode = "day" | "night" | "eye";
type StudioSettingsTab = "general" | "account";

type StudioUser = {
  id?: string | number;
  name?: string;
  email?: string;
  default_workspace_id?: string | number;
  plan_tier?: string;
};

const surfaceModeOptions: Array<{ id: StudioSurfaceMode; label: string }> = [
  { id: "day", label: "白天" },
  { id: "night", label: "黑夜" },
  { id: "eye", label: "护眼" },
];

const studioSurfaceStyle: Record<StudioSurfaceMode, {
  root: string;
  header: string;
  logo: string;
  title: string;
  subtitle: string;
  chromeButton: string;
  chromeActive: string;
  canvasShell: string;
}> = {
  day: {
    root: "bg-[radial-gradient(circle_at_28%_0%,rgba(255,255,255,0.92),transparent_30%),linear-gradient(135deg,#f6f4ee_0%,#eeeae0_48%,#e5dfd1_100%)] text-[#171512]",
    header: "border-black/[0.08] bg-white/[0.76] shadow-[0_12px_40px_rgba(25,23,18,0.12)]",
    logo: "border-black/[0.08] bg-black text-white",
    title: "text-[#171512]",
    subtitle: "text-black/[0.46]",
    chromeButton: "border-black/[0.08] bg-black/[0.04] text-black/[0.52] hover:bg-black hover:text-white",
    chromeActive: "bg-black text-white",
    canvasShell: "border-black/[0.08] bg-white/[0.34] shadow-[0_30px_90px_rgba(25,23,18,0.16)]",
  },
  night: {
    root: "bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.06),transparent_28%),linear-gradient(135deg,#050505_0%,#0A0A0B_45%,#111113_100%)] text-white",
    header: "border-white/[0.08] bg-black/[0.72] shadow-[0_12px_40px_rgba(0,0,0,0.28)]",
    logo: "border-white/[0.1] bg-white text-black",
    title: "text-white",
    subtitle: "text-white/[0.42]",
    chromeButton: "border-white/[0.08] bg-white/[0.04] text-white/[0.45] hover:bg-white hover:text-black",
    chromeActive: "bg-white text-black",
    canvasShell: "border-white/[0.08] bg-white/[0.035] shadow-[0_30px_100px_rgba(0,0,0,0.45)]",
  },
  eye: {
    root: "bg-[radial-gradient(circle_at_28%_0%,rgba(239,230,209,0.13),transparent_30%),linear-gradient(135deg,#1b1814_0%,#222018_48%,#2a261d_100%)] text-[#efe6d1]",
    header: "border-[#e8dcc4]/[0.1] bg-[#171410]/[0.76] shadow-[0_12px_40px_rgba(0,0,0,0.25)]",
    logo: "border-[#efe6d1]/[0.14] bg-[#efe6d1] text-[#1d1a15]",
    title: "text-[#f5ecd8]",
    subtitle: "text-[#efe6d1]/[0.46]",
    chromeButton: "border-[#efe6d1]/[0.1] bg-[#efe6d1]/[0.05] text-[#efe6d1]/[0.52] hover:bg-[#efe6d1] hover:text-[#1d1a15]",
    chromeActive: "bg-[#efe6d1] text-[#1d1a15]",
    canvasShell: "border-[#e8dcc4]/[0.1] bg-[#efe6d1]/[0.035] shadow-[0_30px_100px_rgba(0,0,0,0.34)]",
  },
};

const statusStyle: Record<StageStatus, string> = {
  empty: "border-surface-border bg-surface-card text-text-tertiary",
  draft: "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  done: "border-emerald-400/40 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
};

const statusText: Record<StageStatus, string> = {
  empty: "空",
  draft: "草稿",
  done: "完成",
};

function getNodeKind(node: CanvasNode) {
  return node.type;
}

function kindMeta(kind: string) {
  if (kind === "script") return { label: "剧本", icon: FileText, tone: "text-slate-600 bg-slate-500/10 border-slate-500/20" };
  if (kind === "assets") return { label: "角色/场景", icon: Box, tone: "text-blue-500 bg-blue-500/10 border-blue-500/20" };
  if (kind === "shot") return { label: "镜头记录", icon: Clapperboard, tone: "text-orange-500 bg-orange-500/10 border-orange-500/20" };
  if (kind === "image") return { label: "分镜图", icon: ImageIcon, tone: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20" };
  if (kind === "video") return { label: "视频", icon: Video, tone: "text-violet-500 bg-violet-500/10 border-violet-500/20" };
  if (kind === "director") return { label: "导演台", icon: LayoutGrid, tone: "text-purple-500 bg-purple-500/10 border-purple-500/20" };
  if (kind === "text") return { label: "文本", icon: FileText, tone: "text-slate-500 bg-slate-500/10 border-slate-500/20" };
  if (kind === "generator") return { label: "生成器", icon: Sparkles, tone: "text-brand bg-brand/10 border-brand/20" };
  if (kind === "character") return { label: "角色", icon: Users, tone: "text-blue-500 bg-blue-500/10 border-blue-500/20" };
  if (kind === "scene") return { label: "场景", icon: TreePine, tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" };
  if (kind === "prop") return { label: "道具", icon: Box, tone: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
  if (kind === "style") return { label: "风格", icon: Sparkles, tone: "text-purple-500 bg-purple-500/10 border-purple-500/20" };
  return { label: "元素", icon: Box, tone: "text-text-secondary bg-surface-card border-surface-border" };
}

function getAssetDeletePayload(asset: { id: string } & Record<string, unknown>): { id: string; source?: "semantic" | "library" } {
  const source: "semantic" | "library" | undefined = asset.source === "semantic" || asset.source === "library" ? asset.source : undefined;
  const storedAssetId = typeof asset.storedAssetId === "string" ? asset.storedAssetId : undefined;
  return {
    id: source === "library" && storedAssetId ? storedAssetId : asset.id,
    source,
  };
}

function getAssetDropPayload(asset: {
  id: string;
  storedAssetId?: string;
  name: string;
  kind?: string;
  summary?: string;
  lockPrompt?: string;
  image?: string;
  source?: "semantic" | "library";
}): CanvasAssetDropPayload {
  return {
    id: asset.source === "library" && asset.storedAssetId ? asset.storedAssetId : asset.id,
    name: asset.name,
    kind: asset.kind,
    summary: asset.summary,
    lockPrompt: asset.lockPrompt,
    image: asset.image,
    source: asset.source,
  };
}

function normalizeAssetLibraryName(name: string) {
  return name
    .replace(/[-_\s]*(资产图|角色图|设定图|基础形象)$/i, "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeAssetLibraryKind(kind?: string) {
  const value = String(kind || "assets").toLowerCase();
  if (value.includes("character") || value.includes("角色")) return "character";
  if (value.includes("scene") || value.includes("场景")) return "scene";
  if (value.includes("prop") || value.includes("道具")) return "prop";
  if (value.includes("style") || value.includes("风格")) return "style";
  return value;
}

export default function ManjuStudioLayout({
  projectName,
  activeStep,
  onStepChange,
  onGenerate,
  generating,
  nodes,
  connections,
  onNodeMove,
  onNodeSelect,
  onNodeDoubleClick,
  onUpdateNodeContent,
  onAddNode,
  onDeleteNode,
  onToggleCollapse,
  selectedNodeId,
  onSave,
  onAutoLayout,
  onBatchGenerate,
  onConnectNodes,
  onDropAsset,
  onDeleteAsset,
  onExport,
  onImport,
  onImportScriptFile,
  onNewProject,
  onSettings,
  onNodeUpload,
  onNodeGenerate,
  onNodePickFromLibrary,
  nodeAssets,
  mentionAssets,
  composerSettings,
  composerOptions,
  onComposerSettingsChange,
  onBindAssetMention,
  onRewriteAsset,
  onChatAsset,
  assetRewriting,
  assetChatting,
  composerGenerating,
  storyboardShotCount,
  storyboardImageCount,
  storyboardVideoCount,
  children,
  rightPanel,
  storyFlowNav,
}: ManjuStudioLayoutProps) {
  const router = useRouter();
  const { language, setLanguage, languages } = useI18n();
  const { credits, fetchCredits } = useCredits();
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"node" | "project">("node");
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibraryMode, setAssetLibraryMode] = useState<"canvas" | "assets">("canvas");
  const [assetKind, setAssetKind] = useState<string>("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [surfaceMode, setSurfaceMode] = useState<StudioSurfaceMode>("night");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<StudioSettingsTab>("general");
  const [studioUser, setStudioUser] = useState<StudioUser | null>(null);
  const previousActiveStepRef = useRef(activeStep);

  useEffect(() => {
    if (activeStep === "storyboardImage" || activeStep === "storyboardVideo") {
      setRightPanelOpen(true);
      setRightPanelTab("node");
    }
  }, [activeStep]);

  const surfaceStyle = studioSurfaceStyle[surfaceMode];

  useEffect(() => {
    const readUser = () => {
      if (typeof window === "undefined") return;
      const raw = localStorage.getItem("user");
      if (!raw) {
        setStudioUser(null);
        return;
      }
      try {
        setStudioUser(JSON.parse(raw) as StudioUser);
      } catch {
        setStudioUser(null);
      }
    };
    readUser();
    window.addEventListener("auth-changed", readUser);
    window.addEventListener("storage", readUser);
    return () => {
      window.removeEventListener("auth-changed", readUser);
      window.removeEventListener("storage", readUser);
    };
  }, []);

  useEffect(() => {
    if (settingsOpen && settingsTab === "account") {
      fetchCredits();
    }
  }, [fetchCredits, settingsOpen, settingsTab]);

  useEffect(() => {
    const previous = previousActiveStepRef.current;
    previousActiveStepRef.current = activeStep;
    if (activeStep !== previous && activeStep !== "overview") {
      setRightPanelOpen(true);
      setRightPanelTab("node");
    }
  }, [activeStep]);

  const scriptNode = nodes.find((n) => n.type === "script");
  const assetNodes = nodes.filter((n) => n.type === "assets");
  const shotNodes = nodes.filter((n) => n.type === "shot" || n.type === "image" || n.type === "video");
  const imageNodes = nodes.filter((n) => n.type === "image" || n.type === "video");
  const videoNodes = nodes.filter((n) => n.type === "video");
  const reviewShotCount = storyboardShotCount ?? shotNodes.length;
  const reviewImageCount = storyboardImageCount ?? imageNodes.length;
  const reviewVideoCount = storyboardVideoCount ?? videoNodes.length;
  const activeSelectedNodeId = internalSelectedNodeId ?? selectedNodeId ?? null;
  const selectedComposerNode = nodes.find((n) => n.id === activeSelectedNodeId) || null;

  const stages: Stage[] = [
    {
      id: "script",
      label: "故事剧本",
      desc: scriptNode ? `${reviewShotCount ? `${reviewShotCount} 镜头 · ` : ""}可改剧本` : "写小说/生成剧本",
      status: scriptNode ? "done" : "empty",
      generate: "script",
      activeWhen: ["script", "novel"],
    },
    {
      id: "assets",
      label: "角色场景",
      desc: assetNodes.length ? `${assetNodes.length} 个资产` : scriptNode ? "待提取资产" : "等待剧本",
      status: assetNodes.length ? "done" : scriptNode ? "draft" : "empty",
      generate: "assets",
      activeWhen: ["assets"],
    },
    {
      id: "storyboardImage",
      label: "分镜成片",
      desc: `${reviewImageCount}/${reviewShotCount} 图 · ${reviewVideoCount}/${reviewShotCount} 视频`,
      status: reviewVideoCount ? "done" : reviewShotCount || reviewImageCount ? "draft" : "empty",
      generate: reviewImageCount && reviewVideoCount < reviewShotCount ? "storyboardVideo" : "storyboardImage",
      activeWhen: ["storyboardImage", "storyboardVideo", "videoSegments"],
    },
  ];
  const canvasStatus = `${nodes.length} 节点 · ${connections?.length || 0} 连线`;

  const getStageActionMeta = (stage: Stage): StageActionMeta | null => {
    if (!stage.generate) return null;
    if (stage.generate === "script") {
      return {
        label: scriptNode ? "改剧本" : "写小说",
        title: scriptNode ? "使用 AI 写作助手改写当前剧本" : "使用 AI 写作助手生成本集小说/剧情",
      };
    }
    if (stage.generate === "assets") {
      const disabled = !scriptNode;
      return {
        label: "生成资产",
        title: disabled ? "请先完成剧本，再从剧本提取角色、场景、道具资产" : "从剧本提取角色、场景、道具资产，并创建资产节点",
        disabled,
      };
    }
    if (stage.id === "storyboardImage") {
      if (reviewImageCount > 0 && reviewVideoCount < reviewShotCount) {
        const disabled = reviewImageCount === 0;
        return {
          label: "生成视频",
          title: disabled ? "请先生成分镜图，再批量生成 Seedance 视频" : "按分镜图和视频提示词批量生成 Seedance 视频",
          disabled,
          generate: "storyboardVideo",
        };
      }
      const disabled = reviewShotCount === 0;
      return {
        label: "生成分镜图",
        title: disabled ? "请先生成/解析镜头列表，再批量生成分镜图" : "按镜头列表提示词批量生成 Seedream 分镜图",
        disabled,
        generate: "storyboardImage",
      };
    }
    if (stage.generate === "storyboardVideo") {
      const disabled = reviewImageCount === 0;
      return {
        label: "生成视频",
        title: disabled ? "请先生成分镜图，再批量生成 Seedance 视频" : "按分镜图和视频提示词批量生成 Seedance 视频",
        disabled,
        generate: "storyboardVideo",
      };
    }
    return null;
  };

  const canvasElementItems = useMemo(() => {
    const semanticNames = new Set((mentionAssets || []).map((asset) => normalizeAssetLibraryName(asset.name || "")));
    const semanticImages = new Set((mentionAssets || [])
      .map((asset) => String(asset.imageUrl || asset.image_url || asset.url || ""))
      .filter(Boolean));

    return nodes
      .map((node) => ({
        id: node.id,
        name: String(node.title || node.data?.name || "未命名元素"),
        kind: getNodeKind(node),
        summary: String(node.data?.subtitle || node.data?.summary || node.data?.content || node.data?.body || ""),
        image: String(node.data?.thumbnail || node.data?.image_url || node.data?.imageUrl || node.data?.url || ""),
      }))
      .filter((item) => {
        const normalizedName = normalizeAssetLibraryName(item.name);
        const isSemanticRender = item.kind === "assets"
          && (semanticNames.has(normalizedName) || Boolean(item.image && semanticImages.has(item.image)));
        return !isSemanticRender;
      })
      .filter((item) => assetKind === "all" || item.kind === assetKind)
      .filter((item) => {
        const q = assetQuery.trim().toLowerCase();
        if (!q) return true;
        return item.name.toLowerCase().includes(q) || item.summary.toLowerCase().includes(q);
      });
  }, [assetKind, assetQuery, mentionAssets, nodes]);

  const materialAssetItems = useMemo(() => {
    const rawLibraryItems = (nodeAssets || []).map((asset) => ({
      id: asset.publicId || asset.id,
      storedAssetId: asset.id,
      name: asset.name || "未命名素材",
      kind: asset.kind || asset.category || "assets",
      summary: asset.summary || "",
      image: asset.url || asset.image_url || "",
      source: "library" as const,
    }));
    const semanticItems = (mentionAssets || []).map((asset) => {
      const kind = asset.kind || asset.category || "assets";
      const normalizedKind = normalizeAssetLibraryKind(kind);
      const normalizedName = normalizeAssetLibraryName(asset.name || "未命名资产");
      const fallbackImage = rawLibraryItems.find((item) => {
        const libraryName = normalizeAssetLibraryName(item.name);
        return item.image && libraryName === normalizedName;
      })?.image || "";
      return {
        id: asset.id,
        name: asset.name || "未命名资产",
        kind,
        summary: asset.summary || "",
        lockPrompt: asset.lockPrompt || "",
        image: asset.imageUrl || asset.image_url || asset.url || fallbackImage,
        source: "semantic" as const,
      };
    });
    const semanticKeys = new Set(semanticItems.map((item) => `${normalizeAssetLibraryKind(item.kind)}::${normalizeAssetLibraryName(item.name)}`));
    const semanticNames = new Set(semanticItems.map((item) => normalizeAssetLibraryName(item.name)));
    const semanticImages = new Set(semanticItems.map((item) => item.image).filter(Boolean));
    const libraryItems = rawLibraryItems.filter((item) => {
      const normalizedKind = normalizeAssetLibraryKind(item.kind);
      const normalizedName = normalizeAssetLibraryName(item.name);
      const looksLikeSemanticRender = semanticNames.has(normalizedName)
        || (["character", "scene", "prop", "style"].includes(normalizedKind) && semanticKeys.has(`${normalizedKind}::${normalizedName}`))
        || Boolean(item.image && semanticImages.has(item.image));
      return !looksLikeSemanticRender;
    });
    const merged = [...semanticItems, ...libraryItems];
    const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
    return deduped
      .filter((item) => assetKind === "all" || item.kind === assetKind)
      .filter((item) => {
        const q = assetQuery.trim().toLowerCase();
        if (!q) return true;
        return item.name.toLowerCase().includes(q) || item.summary.toLowerCase().includes(q);
      });
  }, [assetKind, assetQuery, mentionAssets, nodeAssets]);

  const assetLibraryItems = assetLibraryMode === "canvas" ? canvasElementItems : materialAssetItems;
  const openCanvasElements = () => {
    setAssetKind("all");
    setAssetQuery("");
    setAssetLibraryMode("canvas");
    setAssetLibraryOpen(true);
  };
  const openAssetLibrary = () => {
    setAssetKind("all");
    setAssetQuery("");
    setAssetLibraryMode("assets");
    setAssetLibraryOpen(true);
  };

  const openProjectPanel = () => {
    setRightPanelTab("project");
    setRightPanelOpen(true);
  };

  const openNodePanel = () => {
    setRightPanelTab("node");
    setRightPanelOpen(true);
  };

  const selectNodeOnly = (id: string | null) => {
    onNodeSelect?.(id);
    setInternalSelectedNodeId(id);
  };

  const goBack = () => {
    if (typeof window !== "undefined") {
      const referrer = document.referrer;
      const hasSameOriginReferrer = (() => {
        if (!referrer) return false;
        try {
          return new URL(referrer).origin === window.location.origin;
        } catch {
          return false;
        }
      })();
      if (hasSameOriginReferrer && window.history.length > 1) {
        router.back();
        return;
      }
    }
    router.push("/");
  };

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden", surfaceStyle.root)}>
      <header className={cn("flex h-[52px] shrink-0 items-center gap-2 border-b px-3 backdrop-blur-xl", surfaceStyle.header)}>
        <div className="flex min-w-[190px] items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border transition", surfaceStyle.chromeButton)}
            title="回到上一页"
            aria-label="回到上一页"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-2xl border shadow-sm", surfaceStyle.logo)}>
            <Clapperboard className="h-4 w-4 shrink-0" />
          </span>
          <div className="min-w-0">
            <div className={cn("truncate text-[13px] font-semibold tracking-[-0.01em]", surfaceStyle.title)}>{projectName || "未命名漫剧"}</div>
            <div className={cn("text-[10px] font-medium", surfaceStyle.subtitle)}>画布流程 · {canvasStatus}</div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-start gap-0.5 overflow-hidden pr-2">
          {storyFlowNav ? storyFlowNav : stages.map((stage, index) => {
            const action = getStageActionMeta(stage);
            const actionGenerate = action?.generate || stage.generate;
            const isActiveStage = stage.activeWhen?.includes(activeStep) || activeStep === stage.id;
            const isGeneratingStage = Boolean(actionGenerate && generating === actionGenerate);
            return (
              <div key={stage.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onStepChange(stage.id);
                  }}
                  className={cn(
                    "group flex h-8 min-w-[112px] items-center justify-between gap-2 rounded-full border px-2.5 text-left transition hover:border-white/[0.24] hover:bg-white/[0.08]",
                    isActiveStage ? "border-white bg-white text-black shadow-sm" : "border-white/[0.08] bg-white/[0.04] text-white/[0.68]"
                  )}
                  title={`进入${stage.label}工作区：${stage.desc}`}
                >
                  <div className="min-w-0">
                    <div className={cn("truncate text-[11px] font-semibold", isActiveStage ? "text-black" : "text-white/[0.78]")}>{stage.label}</div>
                    <div className={cn("truncate text-[9px]", isActiveStage ? "text-black/50" : "text-white/[0.35]")}>{stage.desc}</div>
                  </div>
                  <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", isActiveStage ? "border-black/10 bg-black/[0.06] text-black/[0.62]" : "border-white/[0.08] bg-white/[0.04] text-white/[0.38]")}>
                    {isGeneratingStage ? "生成中" : statusText[stage.status]}
                  </span>
                </button>
                {stage.id === "script" && onImportScriptFile && (
                  <label
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 text-[11px] font-semibold text-white/[0.58] shadow-sm transition hover:bg-white hover:text-black"
                    title="上传 .md/.txt 剧本，并自动解析成镜头列表"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>上传剧本</span>
                    <input type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={onImportScriptFile} />
                  </label>
                )}
                {action && (
                  <button
                    type="button"
                    aria-disabled={action.disabled || isGeneratingStage}
                    onClick={() => {
                      if (action.disabled || isGeneratingStage) {
                        toast.info(action.title);
                        return;
                      }
                      onStepChange(stage.id);
                      if (actionGenerate) onGenerate?.(actionGenerate);
                    }}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition",
                      action.disabled || isGeneratingStage
                        ? "cursor-not-allowed border-white/[0.05] bg-white/[0.03] text-white/[0.22]"
                        : "border-white bg-white text-black shadow-sm hover:bg-white/[0.88]"
                    )}
                    title={action.title}
                    aria-label={action.title}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{isGeneratingStage ? "生成中" : action.label}</span>
                  </button>
                )}
                {index < stages.length - 1 && <ChevronRight className="mx-0.5 h-3 w-3 text-white/[0.18]" />}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", surfaceStyle.chromeButton)} title="项目内容会自动保存到当前项目">
            <span className="h-1.5 w-1.5 rounded-full bg-white/[0.62]" />自动保存
          </div>
          <button type="button" onClick={openProjectPanel} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs", surfaceStyle.chromeButton)} title="项目/导入导出">
            <FolderOpen className="h-3.5 w-3.5" />项目
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} className={cn("flex h-8 w-8 items-center justify-center rounded-full border", surfaceStyle.chromeButton)} title="设置">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/[0.48] px-4 backdrop-blur-[2px]" onMouseDown={() => setSettingsOpen(false)}>
          <div
            className="w-full max-w-[640px] overflow-hidden rounded-[24px] bg-white text-[#171717] shadow-[0_32px_100px_rgba(0,0,0,0.36)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between px-6">
              <div className="text-[20px] font-bold tracking-[-0.02em]">设置</div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-black/[0.45] transition hover:bg-black/[0.06] hover:text-black"
                aria-label="关闭设置"
                title="关闭设置"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex h-11 items-end gap-8 border-b border-black/[0.08] px-6">
              {[
                ["general", "通用"],
                ["account", "账户"],
              ].map(([id, label]) => {
                const active = settingsTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSettingsTab(id as StudioSettingsTab)}
                    className={cn("relative h-11 text-[14px] font-semibold transition", active ? "text-black" : "text-black/[0.35] hover:text-black/[0.62]")}
                  >
                    {label}
                    {active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-black" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-4 bg-[#f7f7f5] px-6 py-5">
              {settingsTab === "general" ? (
                <>
                  <div className="rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[15px] font-semibold text-black">画布外观</div>
                        <div className="mt-0.5 text-[12px] text-black/[0.45]">选择 Seedream Beta 的工作台背景样式</div>
                      </div>
                      <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-black/[0.45]">
                        当前：{surfaceModeOptions.find((option) => option.id === surfaceMode)?.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      {surfaceModeOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSurfaceMode(option.id)}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left transition",
                            surfaceMode === option.id
                              ? "border-black bg-black text-white shadow-sm"
                              : "border-black/[0.08] bg-[#f4f4f2] text-black hover:border-black/[0.18] hover:bg-white"
                          )}
                        >
                          <div className="text-[13px] font-semibold">{option.label}</div>
                          <div className={cn("mt-1 text-[11px] leading-4", surfaceMode === option.id ? "text-white/[0.58]" : "text-black/[0.42]")}>{option.id === "day" ? "浅色专业工作台" : option.id === "night" ? "黑白高级工作台" : "暖色低对比模式"}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[15px] font-semibold text-black">显示语言</div>
                        <div className="mt-0.5 text-[12px] text-black/[0.45]">同步 AI Space 平台语言设置</div>
                      </div>
                      <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-black/[0.45]">
                        {languages.find((option) => option.code === language)?.label}
                      </span>
                    </div>

                    <div className="grid max-h-56 grid-cols-2 gap-2.5 overflow-y-auto pr-1">
                      {languages.map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          onClick={() => setLanguage(option.code)}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-left transition",
                            language === option.code
                              ? "border-black bg-black text-white shadow-sm"
                              : "border-black/[0.08] bg-[#f4f4f2] text-black hover:border-black/[0.18] hover:bg-white"
                          )}
                        >
                          <div className="text-[13px] font-semibold">{option.label}</div>
                          <div className={cn("mt-1 text-[11px] leading-4", language === option.code ? "text-white/[0.58]" : "text-black/[0.42]")}>{option.labelEn}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between gap-4 rounded-xl bg-[#f5f5f4] p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-[15px] font-bold text-white">
                          {(studioUser?.name || studioUser?.email || "U").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-semibold text-black">{studioUser?.name || studioUser?.email || "未登录用户"}</div>
                          <div className="mt-0.5 truncate text-[12px] text-black/[0.42]">{studioUser?.email || "请先登录 AI Space 账户"}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          if (!studioUser) {
                            router.push("/login?returnUrl=/seedream-beta");
                            return;
                          }
                          localStorage.removeItem("token");
                          localStorage.removeItem("user");
                          localStorage.removeItem("current-workspace");
                          window.dispatchEvent(new Event("auth-changed"));
                          router.push("/");
                        }}
                        className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-black shadow-sm transition hover:bg-black hover:text-white"
                      >
                        {studioUser ? "退出登录" : "去登录"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="mb-3 text-[15px] font-semibold text-black">AI Space 账户</div>
                    <div className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06] bg-[#fafaf9]">
                      {[
                        ["用户 ID", studioUser?.id ? String(studioUser.id) : "未读取到"],
                        ["默认工作区", studioUser?.default_workspace_id ? String(studioUser.default_workspace_id) : "未设置"],
                        ["会员层级", credits?.plan_tier || studioUser?.plan_tier || "未读取到"],
                        ["内测积分", credits?.beta_credit_balance_display != null ? String(credits.beta_credit_balance_display) : credits?.beta_credit_balance != null ? String(credits.beta_credit_balance) : "未读取到"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-4 px-3 py-3">
                          <div className="text-[13px] font-semibold text-black">{label}</div>
                          <div className="min-w-0 truncate text-right text-[12px] text-black/[0.48]">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[15px] font-semibold text-black">高级设置</div>
                        <div className="mt-0.5 text-[12px] text-black/[0.45]">打开原有设置面板，继续调整模型、参数或项目配置</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          onSettings?.();
                        }}
                        className="shrink-0 rounded-lg bg-[#f0f0ef] px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-black hover:text-white"
                      >
                        打开
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}


      <div className="flex flex-1 overflow-hidden p-3 pt-2">
        <div className={cn("relative flex-1 overflow-hidden rounded-[30px] border", surfaceStyle.canvasShell)}>
          <div className="absolute inset-0 p-1.5">
            <ManjuCanvas
              nodes={nodes}
              connections={connections}
              onNodeMove={onNodeMove}
              onNodeSelect={selectNodeOnly}
              onNodeDoubleClick={(node) => {
                onNodeDoubleClick?.(node);
                setInternalSelectedNodeId(node.id);
              }}
              onAddNode={onAddNode}
              onDeleteNode={onDeleteNode}
              onToggleCollapse={onToggleCollapse}
              onAutoLayout={onAutoLayout}
              onBatchGenerate={onBatchGenerate}
              onConnectNodes={onConnectNodes}
              onDropAsset={(asset, x, y) => {
                onDropAsset?.(asset, x, y);
                setAssetLibraryOpen(false);
              }}
              selectedNodeId={activeSelectedNodeId}
              onNodeUpload={onNodeUpload}
              onNodeGenerate={onNodeGenerate}
              onNodePickFromLibrary={(nodeId) => {
                onNodePickFromLibrary?.(nodeId);
                setAssetLibraryOpen(true);
              }}
              nodeAssets={nodeAssets}
              mentionAssets={mentionAssets}
              composerSettings={composerSettings}
              composerOptions={composerOptions}
              composerGenerating={composerGenerating}
              surfaceMode={surfaceMode}
              onUpdateNodeContent={onUpdateNodeContent}
              onComposerSettingsChange={onComposerSettingsChange}
              onBindAssetMention={onBindAssetMention}
              onRewriteAsset={onRewriteAsset}
              onChatAsset={onChatAsset}
              assetRewriting={assetRewriting}
              assetChatting={assetChatting}
            />
          </div>

          {Children.map(children, (child) =>
            isValidElement(child)
              ? cloneElement(child as React.ReactElement<{ onOpenProjectPanel?: () => void; onOpenCanvasElements?: () => void; onOpenAssetLibrary?: () => void }>, {
                  onOpenProjectPanel: openProjectPanel,
                  onOpenCanvasElements: openCanvasElements,
                  onOpenAssetLibrary: openAssetLibrary,
                })
              : child
          )}

          {assetLibraryOpen && (
            <div className="absolute inset-y-4 left-[64px] z-40 flex w-[min(520px,calc(100%-88px))] flex-col overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#0d0d0e]/94 shadow-[0_28px_80px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.04] backdrop-blur-2xl">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-white/[0.035] px-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white text-black">
                      <ImageIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="text-sm font-semibold tracking-[-0.01em] text-white">{assetLibraryMode === "canvas" ? "画布元素" : "资产库"}</div>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-white/[0.38]">
                      {assetLibraryItems.length}/{assetLibraryMode === "canvas" ? nodes.length : (mentionAssets?.length || 0) + (nodeAssets?.length || 0)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-white/[0.34]">
                    {assetLibraryMode === "canvas" ? "当前画布内的节点，点击后定位/选中" : "项目资产与素材库，点击后放入画布"}
                  </div>
                </div>
                <button type="button" onClick={() => setAssetLibraryOpen(false)} className="rounded-full p-1.5 text-white/[0.38] hover:bg-white/[0.08] hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="shrink-0 border-b border-white/[0.08] bg-black/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/[0.28]" />
                    <input
                      value={assetQuery}
                      onChange={(event) => setAssetQuery(event.target.value)}
                      placeholder={assetLibraryMode === "canvas" ? "搜索画布元素、镜头、角色、场景" : "搜索资产、素材、角色、场景"}
                      className="h-9 w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] pl-8 pr-3 text-xs text-white outline-none transition placeholder:text-white/[0.28] focus:border-white/[0.35] focus:bg-white/[0.08]"
                    />
                  </div>
                  {assetLibraryMode === "canvas" && (
                    <button type="button" onClick={() => onAddNode?.("text", 260, 260)} className="h-9 shrink-0 rounded-2xl bg-white px-3 text-xs font-semibold text-black shadow-sm hover:bg-white/[0.88]">
                      新建
                    </button>
                  )}
                </div>

                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
                  {(assetLibraryMode === "canvas" ? [
                    ["all", "全部", Sparkles],
                    ["script", "剧本", FileText],
                    ["assets", "角色场景", Users],
                    ["image", "分镜图", ImageIcon],
                    ["video", "视频", Video],
                    ["text", "文本", FileText],
                  ] : [
                    ["all", "全部", Sparkles],
                    ["character", "角色", Users],
                    ["scene", "场景", TreePine],
                    ["prop", "道具", Box],
                    ["style", "风格", Sparkles],
                    ["assets", "图片素材", ImageIcon],
                  ]).map(([id, label, Icon]) => {
                    const count = id === "all"
                      ? (assetLibraryMode === "canvas" ? nodes.length : materialAssetItems.length)
                      : (assetLibraryMode === "canvas" ? nodes.filter((n) => getNodeKind(n) === id).length : materialAssetItems.filter((n) => n.kind === id).length);
                    return (
                      <button
                        key={String(id)}
                        type="button"
                        onClick={() => setAssetKind(String(id))}
                        className={cn(
                          "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition",
                          assetKind === id ? "border-white bg-white text-black" : "border-white/[0.08] bg-white/[0.04] text-white/[0.45] hover:bg-white hover:text-black"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {String(label)}
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", assetKind === id ? "bg-black/[0.06] text-black/[0.62]" : "bg-white/[0.06] text-white/[0.32]")}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto bg-black/16 p-3.5">
                {assetLibraryItems.length === 0 ? (
                  <div className="col-span-2 flex h-52 flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.12] bg-white/[0.025] text-center">
                    <ImageIcon className="mb-2 h-8 w-8 text-white/[0.24]" />
                    <div className="text-sm font-semibold text-white/[0.68]">{assetLibraryMode === "canvas" ? "暂无画布元素" : "暂无资产"}</div>
                    <div className="mt-1 max-w-64 text-xs leading-5 text-white/[0.34]">
                      {assetLibraryMode === "canvas" ? "点击左侧第一个 + 添加节点，或用顶部流程生成剧本、角色场景和镜头列表。" : "先上传/生成角色、场景、道具图片，或从剧本生成语义资产。"}
                    </div>
                  </div>
                ) : (
                  assetLibraryItems.map((asset) => {
                    const meta = kindMeta(asset.kind);
                    const Icon = meta.icon;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        draggable={assetLibraryMode === "assets"}
                        onDragStart={(event) => {
                          if (assetLibraryMode !== "assets") return;
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData("application/x-seedream-asset", JSON.stringify(getAssetDropPayload(asset)));
                        }}
                        onClick={() => {
                          if (assetLibraryMode === "canvas") {
                            selectNodeOnly(asset.id);
                          } else {
                            toast.info("拖拽资产卡到画布位置即可插入");
                          }
                        }}
                        title={assetLibraryMode === "canvas" ? "选择画布元素" : "拖拽到画布插入"}
                        className="group cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] text-left shadow-[0_12px_32px_rgba(0,0,0,0.25)] transition hover:-translate-y-0.5 hover:border-white/[0.24] hover:bg-white/[0.06] hover:shadow-[0_18px_42px_rgba(0,0,0,0.35)]"
                      >
                        <div className="relative aspect-[16/10] bg-black">
                          {assetLibraryMode === "assets" && onDeleteAsset && (
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`删除资产 ${asset.name}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const payload = getAssetDeletePayload(asset);
                                onDeleteAsset(payload.id, payload.source);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                event.stopPropagation();
                                const payload = getAssetDeletePayload(asset);
                                onDeleteAsset(payload.id, payload.source);
                              }}
                              className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/65 opacity-0 shadow-lg backdrop-blur transition hover:border-red-300/60 hover:bg-red-500 hover:text-white group-hover:opacity-100"
                              title="删除资产"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {asset.image ? (
                            <img src={asset.image} alt={asset.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_62%)] text-white/[0.24]">
                              <Icon className="h-8 w-8" />
                            </div>
                          )}
                          {!asset.image && (
                            <div className="absolute inset-0 hidden items-center justify-center bg-black/[0.45] group-hover:flex">
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black shadow-sm">生成元素图</span>
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.tone)}>{meta.label}</span>
                            <span className="text-[9px] text-white/[0.24]">{assetLibraryMode === "canvas" ? "节点" : "资产"}</span>
                          </div>
                          <div className="truncate text-[13px] font-semibold text-white/[0.82]">{asset.name}</div>
                          <div className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-white/[0.34]">{asset.summary || "未填写元素描述"}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className={cn("ml-3 flex flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0d0d0e]/92 shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-all duration-200", rightPanelOpen ? "w-[400px]" : "w-10")}>
          {rightPanelOpen ? (
            <div className="flex h-full flex-col">
              <div className="flex h-11 items-center justify-between border-b border-white/[0.08] bg-white/[0.035] px-3">
                <span className="text-xs font-semibold text-white/[0.78]">生产检查</span>
                <button type="button" onClick={() => setRightPanelOpen(false)} className="rounded-full p-1 text-white/[0.38] hover:bg-white/[0.08] hover:text-white">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-black/20 p-3">
                {rightPanelTab === "node" ? (
                  rightPanel ? (
                    rightPanel
                  ) : (
                    <ManjuNodePanel
                      node={nodes.find((n) => n.id === internalSelectedNodeId) || null}
                      onClose={() => {
                        setRightPanelOpen(false);
                        setInternalSelectedNodeId(null);
                      }}
                      onDeleteNode={onDeleteNode}
                    />
                  )
                ) : (
                  <ManjuProjectIO
                    projectName={projectName}
                    nodes={nodes}
                    connections={connections || []}
                    onSave={() => {
                      onSave?.();
                      toast.success("已保存到本地");
                    }}
                    onExport={() => {
                      onExport?.();
                      toast.success("已导出 JSON");
                    }}
                    onImport={() => {
                      onImport?.();
                      toast.success("已导入项目");
                    }}
                    onClose={() => setRightPanelOpen(false)}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center gap-2 bg-black/30 py-2">
              <button type="button" onClick={() => setRightPanelOpen(true)} className="rounded-full p-1.5 text-white/[0.38] hover:bg-white hover:text-black" title="展开生产检查">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="mt-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 text-[10px] font-bold text-white/[0.34] [writing-mode:vertical-rl]">生产检查</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
