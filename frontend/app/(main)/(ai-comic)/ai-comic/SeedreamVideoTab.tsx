"use client";

import { Loader2, Play } from "lucide-react";
import { getVideoDurationOptions, getVideoResolutionOptions, VIDEO_ASPECTS, VIDEO_MODELS } from "./constants";
import { FieldLabel, PillButton } from "./components";

type Props = {
  t: (key: string, params?: Record<string, string>) => string;
  videoPrompt: string;
  setVideoPrompt: (value: string) => void;
  videoModel: string;
  setVideoModel: (value: string) => void;
  videoAspect: string;
  setVideoAspect: (value: string) => void;
  videoResolution: string;
  setVideoResolution: (value: string) => void;
  videoDuration: number;
  setVideoDuration: (value: number) => void;
  videoAudio: boolean;
  setVideoAudio: (value: boolean) => void;
  selectedImageRefs: string[];
  selectedVideoRefs: string[];
  videoGenerating: boolean;
  submitVideo: () => void;
};

export default function SeedreamVideoTab({
  t,
  videoPrompt,
  setVideoPrompt,
  videoModel,
  setVideoModel,
  videoAspect,
  setVideoAspect,
  videoResolution,
  setVideoResolution,
  videoDuration,
  setVideoDuration,
  videoAudio,
  setVideoAudio,
  selectedImageRefs,
  selectedVideoRefs,
  videoGenerating,
  submitVideo,
}: Props) {
  return (
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
            {getVideoResolutionOptions(videoModel).map((item) => (
              <PillButton key={item} active={videoResolution === item} onClick={() => setVideoResolution(item)}>{item}</PillButton>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>{t("seedreamBeta.duration")}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {getVideoDurationOptions(videoModel).map((item) => (
              <PillButton key={item} active={videoDuration === item} onClick={() => setVideoDuration(item)}>{item === -1 ? "自动" : `${item}s`}</PillButton>
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
  );
}
