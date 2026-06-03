"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { useI18n, type LanguageCode } from "@/lib/i18n";
import type { ModelAvatarMeta } from "@/lib/models/modelAvatars";

function prefersChinese(language: LanguageCode) {
  return language === "zh-CN" || language === "zh-TW";
}

export function ModelAvatar({
  meta,
  size = "md",
  className,
}: {
  meta: ModelAvatarMeta;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const { language } = useI18n();
  const Icon = meta.icon;
  const label = !prefersChinese(language) && meta.labelEn ? meta.labelEn : meta.label;
  const pixelSize = size === "xs" ? 16 : size === "sm" ? 20 : size === "md" ? 24 : 28;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        size === "xs" && "h-4 w-4 text-[8px]",
        size === "sm" && "h-5 w-5 text-[9px]",
        size === "md" && "h-6 w-6 text-[10px]",
        size === "lg" && "h-7 w-7 text-[11px]",
        className
      )}
      style={{ backgroundColor: meta.background, color: meta.color }}
      title={label}
    >
      {meta.iconSrc ? (
        <Image
          src={meta.iconSrc}
          alt=""
          width={pixelSize}
          height={pixelSize}
          className="h-full w-full object-contain p-[3px]"
          aria-hidden="true"
          unoptimized
        />
      ) : Icon ? (
        <Icon className="h-[74%] w-[74%]" />
      ) : (
        meta.fallback
      )}
    </span>
  );
}
