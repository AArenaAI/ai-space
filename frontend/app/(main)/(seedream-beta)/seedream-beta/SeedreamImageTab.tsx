"use client";

import { Loader2, Sparkles } from "lucide-react";
import { IMAGE_ASPECTS, IMAGE_RESOLUTIONS } from "./constants";
import { FieldLabel, PillButton } from "./components";

type Props = {
  t: (key: string, params?: Record<string, string>) => string;
  imagePrompt: string;
  setImagePrompt: (value: string) => void;
  imageAspect: string;
  setImageAspect: (value: string) => void;
  imageResolution: string;
  setImageResolution: (value: string) => void;
  selectedImageRefs: string[];
  isGenerating: boolean;
  submitImage: () => void;
};

export default function SeedreamImageTab({
  t,
  imagePrompt,
  setImagePrompt,
  imageAspect,
  setImageAspect,
  imageResolution,
  setImageResolution,
  selectedImageRefs,
  isGenerating,
  submitImage,
}: Props) {
  return (
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
  );
}
