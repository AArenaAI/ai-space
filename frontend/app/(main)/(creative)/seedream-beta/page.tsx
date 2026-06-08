"use client";

import { useMemo, useState } from "react";
import { Download, ImageIcon, Loader2, Maximize2, Play, Sparkles, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useImage, type GeneratedImage } from "@/hooks/useImage";
import { useVideo, type VideoGeneration } from "@/hooks/useVideo";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/errors";

const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const IMAGE_RESOLUTIONS = ["2K"];
const SEEDREAM_IMAGE_QUALITY = "medium";

const VIDEO_MODELS = ["doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-pro-260128"];
const VIDEO_ASPECTS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"];
const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const VIDEO_DURATIONS = [5, 10, 15];

type Tab = "image" | "video";

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

export default function SeedreamBetaPage() {
  const { t } = useI18n();
  const { images, generateImage, isGenerating } = useImage("seedream");
  const { videos, generateVideo, generating: videoGenerating } = useVideo();

  const [tab, setTab] = useState<Tab>("image");
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

  const lastImage: GeneratedImage | undefined = useMemo(() => {
    if (!lastImageId) return images[0];
    return images.find((item) => item.id === lastImageId) || images[0];
  }, [images, lastImageId]);

  const lastVideo: VideoGeneration | undefined = useMemo(() => {
    if (!lastVideoId) return videos[0];
    return videos.find((item) => item.id === lastVideoId) || videos[0];
  }, [videos, lastVideoId]);

  const submitImage = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error(t("seedreamBeta.promptRequired"));
      return;
    }
    try {
      const data = await generateImage(prompt, imageAspect, imageResolution, SEEDREAM_IMAGE_QUALITY, undefined, "seedream");
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

            {tab === "image" ? (
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

          <aside className="rounded-3xl border border-surface-border bg-surface-elevated p-5 shadow-sm">
            {tab === "image" ? (
              <div className="flex h-full min-h-[520px] flex-col">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{t("seedreamBeta.imageHistory")}</h2>
                    <p className="mt-1 text-xs text-text-tertiary">{t("seedreamBeta.imageHistoryHint")}</p>
                  </div>
                  <span className="rounded-full bg-surface-card px-2.5 py-1 text-xs text-text-tertiary">{images.length}</span>
                </div>
                {images.length > 0 ? (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
