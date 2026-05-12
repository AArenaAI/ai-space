"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  isOpen: boolean;
  slug?: string;
  onClose: () => void;
}

export default function ShareDialog({ isOpen, slug, onClose }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setCopied(false);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !slug) return null;

  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/share?slug=${slug}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[420px] mx-4 rounded-2xl bg-surface-elevated border border-surface-border shadow-2xl p-6 animate-dialog-appear">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">分享对话</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-card transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4 leading-relaxed">
          已生成分享链接，复制后即可与他人分享这段对话。
        </p>

        <div className="flex items-center gap-2 mb-5">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-card border border-surface-border text-sm text-text-primary truncate">
            <Link2 className="w-4 h-4 shrink-0 text-text-tertiary" />
            <span className="truncate">{shareUrl}</span>
          </div>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
              copied
                ? "bg-green-500/10 text-green-500 border border-green-500/20"
                : "bg-brand text-white hover:bg-brand-hover"
            )}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                复制
              </>
            )}
          </button>
        </div>

        <div className="flex items-center justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-card transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
