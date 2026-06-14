"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, ImageIcon, Loader2, Maximize2, Paperclip, Play, Sparkles, Trash2, UploadCloud, Video, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useImage, type GeneratedImage } from "@/hooks/useImage";
import { useVideo, type VideoGeneration } from "@/hooks/useVideo";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { consumeChatStream } from "@/lib/chatStream";
import { getErrorMessage, readApiError } from "@/lib/errors";

const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_RESOLUTIONS = ["2K"];
const SEEDREAM_IMAGE_QUALITY = "medium";

const VIDEO_MODELS = ["doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-pro-260128"];
const VIDEO_ASPECTS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"];
const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const VIDEO_DURATIONS = [5, 10, 15];
const WORKFLOW_MODEL = "gpt-5.5";

type Tab = "workflow" | "image" | "video";
type WorkflowMode = "novel" | "script" | "assets" | "storyboardVideo" | "storyboardImage";
type AssetKind = "image" | "video" | "file";

type StoredAsset = {
  id: string;
  publicId: string;
  name: string;
  type: AssetKind;
  mimeType?: string;
  size?: number;
  url: string;
  createdAt: string;
};

const ASSET_STORAGE_KEY = "seedream-beta-assets-v1";

const WORKFLOW_STEPS: Array<{ id: WorkflowMode; titleKey: string; descKey: string; buttonKey: string; placeholderKey: string }> = [
  { id: "novel", titleKey: "seedreamBeta.workflow.novelTitle", descKey: "seedreamBeta.workflow.novelDesc", buttonKey: "seedreamBeta.workflow.generateNovel", placeholderKey: "seedreamBeta.workflow.novelPlaceholder" },
  { id: "script", titleKey: "seedreamBeta.workflow.scriptTitle", descKey: "seedreamBeta.workflow.scriptDesc", buttonKey: "seedreamBeta.workflow.generateScript", placeholderKey: "seedreamBeta.workflow.scriptPlaceholder" },
  { id: "assets", titleKey: "seedreamBeta.workflow.assetsTitle", descKey: "seedreamBeta.workflow.assetsDesc", buttonKey: "seedreamBeta.workflow.generateAssets", placeholderKey: "seedreamBeta.workflow.assetsPlaceholder" },
  { id: "storyboardVideo", titleKey: "seedreamBeta.workflow.storyboardVideoTitle", descKey: "seedreamBeta.workflow.storyboardVideoDesc", buttonKey: "seedreamBeta.workflow.generateStoryboardVideo", placeholderKey: "seedreamBeta.workflow.storyboardVideoPlaceholder" },
  { id: "storyboardImage", titleKey: "seedreamBeta.workflow.storyboardImageTitle", descKey: "seedreamBeta.workflow.storyboardImageDesc", buttonKey: "seedreamBeta.workflow.generateStoryboardImage", placeholderKey: "seedreamBeta.workflow.storyboardImagePlaceholder" },
];

const SETTING_BOARD_IMAGES = [
  { name: "沈青檀", role: "图一", src: "/seedream-beta/settings/shen-qingtan.png" },
  { name: "顾南舟", role: "图二", src: "/seedream-beta/settings/gu-nanzhou.png" },
  { name: "沈砚山", role: "图三", src: "/seedream-beta/settings/shen-yanshan.png" },
  { name: "陆衡", role: "图四", src: "/seedream-beta/settings/lu-heng.png" },
  { name: "洄州百姓 / 喜堂宾客群像", role: "图五", src: "/seedream-beta/settings/huizhou-guests.png" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">{children}</div>;
}

function PillButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-brand bg-brand text-white shadow-sm"
          : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/40 hover:text-text-primary"
      )}
    >
      {children}
    </button>
  );
}

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
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

function workflowSystemPrompt(mode: WorkflowMode) {
  const common = "你是 AI Space 的影视/小说创作前期助手。不要联网搜索。输出要直接可编辑、可复制，不要解释思考过程，不要使用 Markdown 代码块。";
  if (mode === "novel") return `${common}\n任务：根据用户创意写完整小说，有明确开端、发展、高潮和结尾；人物动机清楚；画面感强。输出格式：<TITLE>标题</TITLE><CONTENT>完整小说正文</CONTENT>`;
  if (mode === "script") return `${common}\n任务：把用户提供的小说或故事改写成影视剧本。保留主要情节、人物关系和关键情绪。按幕/场组织，每场包含地点、时间、人物、动作、对白/旁白。输出格式：<TITLE>剧本标题</TITLE><SCRIPT>完整剧本</SCRIPT>`;
  if (mode === "assets") return `${common}\n任务：根据剧本提取前期制作资产。必须覆盖角色、场景、关键道具。每个资产都要包含可用于 Seedream 生图的 image_prompt。输出清晰分组。`;
  if (mode === "storyboardVideo") return `${common}\n任务：根据剧本和资产设定生成视频分镜脚本提示词。每个镜头必须包含：镜头编号、场景、画面、镜头运动、角色动作、台词/旁白、建议时长、可直接用于 Seedance 视频生成的 video_prompt。`;
  return `${common}\n任务：根据剧本、资产和视频分镜，生成 Seedream 分镜图提示词。每个镜头一条 image_prompt，强调静态构图、主体、景别、光线、角色/服装/场景一致性。输出编号列表。`;
}

export default function SeedreamBetaPage() {
  const { t } = useI18n();
  const { images, generateImage, isGenerating } = useImage("seedream");
  const { videos, generateVideo, generating: videoGenerating } = useVideo();

  const [tab, setTab] = useState<Tab>("workflow");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("2K");
  const [lastImageId, setLastImageId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);

  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0]);
  const [videoAspect, setVideoAspect] = useState("adaptive");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(false);
  const [lastVideoId, setLastVideoId] = useState<number | null>(null);

  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("novel");
  const [workflowIdea, setWorkflowIdea] = useState("");
  const [workflowNovel, setWorkflowNovel] = useState("");
  const [workflowScript, setWorkflowScript] = useState("");
  const [workflowAssets, setWorkflowAssets] = useState("");
  const [workflowStoryboardVideo, setWorkflowStoryboardVideo] = useState("");
  const [workflowStoryboardImage, setWorkflowStoryboardImage] = useState("");
  const [workflowGenerating, setWorkflowGenerating] = useState<WorkflowMode | null>(null);
  const [assets, setAssets] = useState<StoredAsset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(ASSET_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const lastImage: GeneratedImage | undefined = useMemo(() => {
    if (!lastImageId) return images[0];
    return images.find((item) => item.id === lastImageId) || images[0];
  }, [images, lastImageId]);

  const lastVideo: VideoGeneration | undefined = useMemo(() => {
    if (!lastVideoId) return videos[0];
    return videos.find((item) => item.id === lastVideoId) || videos[0];
  }, [videos, lastVideoId]);

  const workflowStep = WORKFLOW_STEPS.find((item) => item.id === workflowMode) || WORKFLOW_STEPS[0];

  useEffect(() => {
    window.localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(assets));
  }, [assets]);

  const selectedAssets = useMemo(() => assets.filter((item) => selectedAssetIds.includes(item.id)), [assets, selectedAssetIds]);
  const selectedImageRefs = useMemo(() => selectedAssets.filter((item) => item.type === "image").map((item) => item.publicId || item.url), [selectedAssets]);
  const selectedVideoRefs = useMemo(() => selectedAssets.filter((item) => item.type === "video").map((item) => item.publicId || item.url), [selectedAssets]);

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
    if (mode === "script") return workflowNovel.trim() || workflowIdea.trim();
    if (mode === "assets") return workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim();
    if (mode === "storyboardVideo") return `【剧本】\n${workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim()}\n\n【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}`;
    return `【资产】\n${workflowAssets.trim() || "（暂无资产，请自行提取必要一致性信息）"}\n\n【分镜/剧本】\n${workflowStoryboardVideo.trim() || workflowScript.trim() || workflowNovel.trim() || workflowIdea.trim()}`;
  };

  const generateWorkflow = async (mode: WorkflowMode) => {
    const input = buildWorkflowInput(mode);
    if (!input.trim()) {
      toast.error(t("seedreamBeta.workflow.inputRequired"));
      return;
    }
    setWorkflowGenerating(mode);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: WORKFLOW_MODEL,
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
      setWorkflowOutput(mode, stripWorkflowText(raw));
      toast.success(t("seedreamBeta.workflow.generated"));
    } catch (err) {
      toast.error(getErrorMessage(err, { module: "chat", fallbackMessage: t("seedreamBeta.workflow.failed") }));
    } finally {
      setWorkflowGenerating(null);
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

  return (
    <main className="min-h-screen bg-surface-base px-6 py-8 text-text-primary">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{t("seedreamBeta.title")}</h1>
              <p className="mt-1 text-sm text-text-secondary">{t("seedreamBeta.subtitle")}</p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-3xl border border-surface-border bg-surface-elevated p-5 shadow-sm">
            <div className="mb-5 flex rounded-2xl bg-surface-card p-1">
              <button
                type="button"
                onClick={() => setTab("workflow")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors",
                  tab === "workflow" ? "bg-surface-elevated text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <FileText className="h-4 w-4" />
                {t("seedreamBeta.workflowTab")}
              </button>
              <button
                type="button"
                onClick={() => setTab("image")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors",
                  tab === "image" ? "bg-surface-elevated text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <ImageIcon className="h-4 w-4" />
                {t("seedreamBeta.imageTab")}
              </button>
              <button
                type="button"
                onClick={() => setTab("video")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors",
                  tab === "video" ? "bg-surface-elevated text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Video className="h-4 w-4" />
                {t("seedreamBeta.videoTab")}
              </button>
            </div>

            <div className="mb-5 rounded-2xl border border-surface-border bg-surface-card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{t("seedreamBeta.assets.title")}</h2>
                  <p className="mt-1 text-xs text-text-tertiary">{t("seedreamBeta.assets.hint")}</p>
                </div>
                <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-brand px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-hover", uploadingAsset && "pointer-events-none opacity-60")}>
                  {uploadingAsset ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {uploadingAsset ? t("seedreamBeta.assets.uploading") : t("seedreamBeta.assets.upload")}
                  <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={handleAssetFileSelect} />
                </label>
              </div>
              {assets.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {assets.map((asset) => {
                    const selected = selectedAssetIds.includes(asset.id);
                    return (
                      <article key={asset.id} className={cn("rounded-2xl border bg-surface-elevated p-2 transition-colors", selected ? "border-brand/60 ring-2 ring-brand/10" : "border-surface-border")}>
                        <button type="button" onClick={() => toggleAssetSelection(asset.id)} className="block w-full text-left">
                          <div className="relative aspect-video overflow-hidden rounded-xl bg-black/5">
                            {asset.type === "image" ? (
                              <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                            ) : asset.type === "video" ? (
                              <video src={asset.url} className="h-full w-full object-cover" muted />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-text-tertiary"><Paperclip className="h-6 w-6" /></div>
                            )}
                            <span className={cn("absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium", selected ? "bg-brand text-white" : "bg-black/55 text-white")}>{selected ? t("seedreamBeta.assets.selected") : asset.type}</span>
                          </div>
                          <div className="mt-2 min-w-0">
                            <div className="truncate text-sm font-medium text-text-primary">{asset.name}</div>
                            <div className="mt-0.5 text-[11px] text-text-tertiary">{formatAssetSize(asset.size) || asset.type}</div>
                          </div>
                        </button>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-text-tertiary">{selected ? t("seedreamBeta.assets.willReference") : t("seedreamBeta.assets.clickToUse")}</span>
                          <button type="button" onClick={() => removeAsset(asset.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-text-tertiary transition-colors hover:border-red-300 hover:text-red-500" aria-label={t("common.delete")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-surface-border p-5 text-center text-sm text-text-tertiary">{t("seedreamBeta.assets.empty")}</div>
              )}
            </div>

            {tab === "workflow" ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
                  <FieldLabel>{t("seedreamBeta.workflow.ideaLabel")}</FieldLabel>
                  <textarea
                    value={workflowIdea}
                    onChange={(event) => setWorkflowIdea(event.target.value)}
                    placeholder={t("seedreamBeta.workflow.ideaPlaceholder")}
                    className="min-h-28 w-full resize-none rounded-2xl border border-surface-border bg-surface-elevated px-4 py-3 text-sm outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
                  />
                </div>

                <div>
                  <FieldLabel>{t("seedreamBeta.workflow.steps")}</FieldLabel>
                  <div className="grid gap-2 md:grid-cols-5">
                    {WORKFLOW_STEPS.map((step, index) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setWorkflowMode(step.id)}
                        className={cn(
                          "rounded-2xl border p-3 text-left transition-colors",
                          workflowMode === step.id
                            ? "border-brand bg-brand/10 text-text-primary"
                            : "border-surface-border bg-surface-card text-text-secondary hover:border-brand/40 hover:text-text-primary"
                        )}
                      >
                        <div className="mb-1 text-[11px] font-medium text-text-tertiary">0{index + 1}</div>
                        <div className="text-sm font-semibold">{t(step.titleKey)}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-4 text-text-tertiary">{t(step.descKey)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">设定版</h2>
                      <p className="mt-1 text-xs text-text-tertiary">角色与群像参考图，按当前项目设定固定展示。</p>
                    </div>
                    <span className="rounded-full bg-surface-elevated px-2.5 py-1 text-xs text-text-tertiary">{SETTING_BOARD_IMAGES.length}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {SETTING_BOARD_IMAGES.map((item) => (
                      <figure key={item.name} className="overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated">
                        <div className="aspect-square overflow-hidden bg-black/5">
                          <img src={item.src} alt={item.name} className="h-full w-full object-cover" />
                        </div>
                        <figcaption className="space-y-1 p-3">
                          <div className="text-[11px] font-medium text-text-tertiary">{item.role}</div>
                          <div className="text-sm font-semibold text-text-primary">{item.name}</div>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{t(workflowStep.titleKey)}</h2>
                      <p className="mt-1 text-xs text-text-tertiary">{t(workflowStep.descKey)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => generateWorkflow(workflowMode)}
                      disabled={workflowGenerating !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {workflowGenerating === workflowMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      {workflowGenerating === workflowMode ? t("seedreamBeta.workflow.generating") : t(workflowStep.buttonKey)}
                    </button>
                  </div>
                  <textarea
                    value={workflowOutput}
                    onChange={(event) => setWorkflowOutput(workflowMode, event.target.value)}
                    placeholder={t(workflowStep.placeholderKey)}
                    className="min-h-[360px] w-full resize-y rounded-2xl border border-surface-border bg-surface-elevated px-4 py-3 font-mono text-sm leading-6 outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={copyWorkflowOutput} disabled={!workflowOutput.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"><Copy className="h-3.5 w-3.5" />{t("seedreamBeta.workflow.copy")}</button>
                    <button type="button" onClick={sendWorkflowToImage} disabled={!workflowOutput.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"><ImageIcon className="h-3.5 w-3.5" />{t("seedreamBeta.workflow.sendToImage")}</button>
                    <button type="button" onClick={sendWorkflowToVideo} disabled={!workflowOutput.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"><Video className="h-3.5 w-3.5" />{t("seedreamBeta.workflow.sendToVideo")}</button>
                  </div>
                </div>
              </div>
            ) : tab === "image" ? (
              <div className="space-y-5">
                <div>
                  <FieldLabel>{t("seedreamBeta.prompt")}</FieldLabel>
                  <textarea
                    value={imagePrompt}
                    onChange={(event) => setImagePrompt(event.target.value)}
                    placeholder={t("seedreamBeta.imagePromptPlaceholder")}
                    className="min-h-40 w-full resize-none rounded-2xl border border-surface-border bg-surface-card px-4 py-3 text-sm outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
                  />
                </div>

                <div>
                  <FieldLabel>{t("seedreamBeta.aspect")}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_ASPECTS.map((item) => (
                      <PillButton key={item} active={imageAspect === item} onClick={() => setImageAspect(item)}>{item}</PillButton>
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel>{t("seedreamBeta.resolution")}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_RESOLUTIONS.map((item) => (
                      <PillButton key={item} active={imageResolution === item} onClick={() => setImageResolution(item)}>{item}</PillButton>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-text-tertiary">{t("seedreamBeta.seedreamImageSettingsHint")}</p>
                </div>

                {selectedImageRefs.length > 0 && (
                  <div className="rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-xs text-text-secondary">
                    {t("seedreamBeta.assets.imageRefs", { count: String(selectedImageRefs.length) })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitImage}
                  disabled={isGenerating}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isGenerating ? t("seedreamBeta.submitting") : t("seedreamBeta.generateImage")}
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <FieldLabel>{t("seedreamBeta.prompt")}</FieldLabel>
                  <textarea
                    value={videoPrompt}
                    onChange={(event) => setVideoPrompt(event.target.value)}
                    placeholder={t("seedreamBeta.videoPromptPlaceholder")}
                    className="min-h-40 w-full resize-none rounded-2xl border border-surface-border bg-surface-card px-4 py-3 text-sm outline-none transition-colors placeholder:text-text-tertiary focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
                  />
                </div>

                <div>
                  <FieldLabel>{t("seedreamBeta.model")}</FieldLabel>
                  <select
                    value={videoModel}
                    onChange={(event) => setVideoModel(event.target.value)}
                    className="w-full rounded-2xl border border-surface-border bg-surface-card px-4 py-3 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
                  >
                    {VIDEO_MODELS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>

                <div>
                  <FieldLabel>{t("seedreamBeta.aspect")}</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {VIDEO_ASPECTS.map((item) => (
                      <PillButton key={item} active={videoAspect === item} onClick={() => setVideoAspect(item)}>{item}</PillButton>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <FieldLabel>{t("seedreamBeta.resolution")}</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {VIDEO_RESOLUTIONS.map((item) => (
                        <PillButton key={item} active={videoResolution === item} onClick={() => setVideoResolution(item)}>{item}</PillButton>
                      ))}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("seedreamBeta.duration")}</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {VIDEO_DURATIONS.map((item) => (
                        <PillButton key={item} active={videoDuration === item} onClick={() => setVideoDuration(item)}>{item}s</PillButton>
                      ))}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("seedreamBeta.audio")}</FieldLabel>
                    <PillButton active={videoAudio} onClick={() => setVideoAudio(!videoAudio)}>
                      {videoAudio ? t("seedreamBeta.audioOn") : t("seedreamBeta.audioOff")}
                    </PillButton>
                  </div>
                </div>

                {(selectedImageRefs.length > 0 || selectedVideoRefs.length > 0) && (
                  <div className="rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-xs text-text-secondary">
                    {t("seedreamBeta.assets.videoRefs", { imageCount: String(selectedImageRefs.length), videoCount: String(selectedVideoRefs.length) })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitVideo}
                  disabled={videoGenerating}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {videoGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {videoGenerating ? t("seedreamBeta.submitting") : t("seedreamBeta.generateVideo")}
                </button>
              </div>
            )}
          </section>

          <aside
            className={cn(
              "rounded-3xl border border-surface-border bg-surface-elevated p-5 shadow-sm",
              tab === "image" && "flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden lg:sticky lg:top-6"
            )}
          >
            {tab === "workflow" ? (
              <div className="flex h-full min-h-[520px] flex-col gap-4">
                <div>
                  <h2 className="text-base font-semibold">{t("seedreamBeta.workflow.overviewTitle")}</h2>
                  <p className="mt-1 text-xs text-text-tertiary">{t("seedreamBeta.workflow.overviewHint")}</p>
                </div>
                <div className="space-y-2">
                  {WORKFLOW_STEPS.map((step) => {
                    const value = step.id === "novel" ? workflowNovel : step.id === "script" ? workflowScript : step.id === "assets" ? workflowAssets : step.id === "storyboardVideo" ? workflowStoryboardVideo : workflowStoryboardImage;
                    return (
                      <button key={step.id} type="button" onClick={() => setWorkflowMode(step.id)} className={cn("w-full rounded-2xl border p-3 text-left transition-colors", workflowMode === step.id ? "border-brand/50 bg-brand/10" : "border-surface-border bg-surface-card hover:border-brand/40")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-text-primary">{t(step.titleKey)}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px]", value.trim() ? "bg-emerald-500/10 text-emerald-600" : "bg-surface-elevated text-text-tertiary")}>{value.trim() ? t("seedreamBeta.workflow.ready") : t("seedreamBeta.workflow.empty")}</span>
                        </div>
                        {value.trim() && <p className="mt-2 line-clamp-2 text-xs text-text-tertiary">{value}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : tab === "image" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{t("seedreamBeta.imageHistory")}</h2>
                    <p className="mt-1 text-xs text-text-tertiary">{t("seedreamBeta.imageHistoryHint")}</p>
                  </div>
                  <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs text-text-tertiary">{images.length}</span>
                </div>
                {images.length > 0 ? (
                  <div data-testid="seedream-image-history-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
                    {images.map((image) => (
                      <article key={image.id} className="rounded-2xl border border-surface-border bg-surface-card p-3">
                        <div className="flex gap-3">
                          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-black/5">
                            {image.image_url ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImage(image)}
                                className="group relative block h-full w-full"
                                aria-label={t("seedreamBeta.previewImage")}
                              >
                                <img src={image.image_url} alt={image.prompt} className="h-full w-full object-cover" />
                                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
                                  <Maximize2 className="h-4 w-4 text-white" />
                                </span>
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-text-tertiary">{image.status}</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs text-text-tertiary">
                              <span>#{image.id} · {image.status}</span>
                              <span>{image.size}</span>
                            </div>
                            <p className="line-clamp-3 text-sm text-text-secondary">{image.prompt}</p>
                            {image.error_message && <div className="line-clamp-2 text-xs text-red-500">{image.error_message}</div>}
                            {image.image_url && (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPreviewImage(image)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary"
                                >
                                  <Maximize2 className="h-3.5 w-3.5" />
                                  {t("seedreamBeta.previewImage")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadImage(image)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {t("seedreamBeta.saveImage")}
                                </button>
                                {lastImage?.id === image.id && (
                                  <button
                                    type="button"
                                    onClick={addLatestImageToAssets}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    {t("seedreamBeta.assets.saveToLibrary")}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-surface-border p-8 text-center text-sm text-text-tertiary">{t("seedreamBeta.noImageHistory")}</div>
                )}
              </div>
            ) : lastVideo ? (
              <div className="space-y-3">
                <h2 className="mb-4 text-base font-semibold">{t("seedreamBeta.latestResult")}</h2>
                <div className="overflow-hidden rounded-2xl border border-surface-border bg-black">
                  {lastVideo.video_url ? (
                    <video src={lastVideo.video_url} controls className="aspect-video w-full" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-sm text-white/60">{lastVideo.status}</div>
                  )}
                </div>
                <div className="text-xs text-text-tertiary">#{lastVideo.id} · {lastVideo.status}</div>
                {lastVideo.error_message && <div className="text-sm text-red-500">{lastVideo.error_message}</div>}
                <p className="line-clamp-4 text-sm text-text-secondary">{lastVideo.prompt}</p>
                {lastVideo.video_url && (
                  <button type="button" onClick={addLatestVideoToAssets} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary">
                    <Paperclip className="h-3.5 w-3.5" />
                    {t("seedreamBeta.assets.saveToLibrary")}
                  </button>
                )}
              </div>
            ) : (
              <div>
                <h2 className="mb-4 text-base font-semibold">{t("seedreamBeta.latestResult")}</h2>
                <div className="rounded-2xl border border-dashed border-surface-border p-8 text-center text-sm text-text-tertiary">{t("seedreamBeta.noResult")}</div>
              </div>
            )}
          </aside>
        </div>
      </div>
      {previewImage?.image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t("seedreamBeta.previewImage")}
          onClick={() => setPreviewImage(null)}
        >
          <div className="absolute right-4 top-4 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                downloadImage(previewImage);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <Download className="h-4 w-4" />
              {t("seedreamBeta.saveImage")}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewImage(null);
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
              aria-label={t("seedreamBeta.closePreview")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <img
            src={previewImage.image_url}
            alt={previewImage.prompt}
            className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}
