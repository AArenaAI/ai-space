"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, ChevronDown, Download, FileText, ImageIcon, Share2, SquareCheck, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type SelectionMode = "share" | "favorite";

function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-elevated border border-surface-border shadow-xl",
        className
      )}
    >
      {children}
    </div>
  );
}

function ActionBarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

function ActionBarButton({
  children,
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "primary" }) {
  return (
    <button
      {...props}
      className={cn(
        "flex items-center gap-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary"
          ? "px-4 py-1.5 font-medium bg-brand text-white hover:bg-brand-hover"
          : "px-3 py-1.5 text-text-secondary hover:bg-surface-card hover:text-text-primary",
        className
      )}
    >
      {children}
    </button>
  );
}

function ExportDropdown({
  onExportImage,
  onExportText,
  disabled,
  exporting,
}: {
  onExportImage: () => void;
  onExportText: () => void;
  disabled: boolean;
  exporting: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-surface-card border border-surface-border text-text-primary hover:bg-surface-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        {exporting ? t("chat.export.exporting") : t("chat.export.exportAs")}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 w-36 rounded-xl border border-surface-border bg-surface-elevated shadow-xl z-50 py-1 animate-fade-in">
            <button
              onClick={() => { onExportImage(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              {t("chat.export.asImage")}
            </button>
            <button
              onClick={() => { onExportText(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {t("chat.export.asTxt")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SelectionFloatingBar({
  selectionMode,
  selectedCount,
  hasSelection,
  allSelected,
  sharing,
  exporting,
  favoriteLoading,
  onCancel,
  onSelectAll,
  onConfirmShare,
  onConfirmFavorite,
  onExportImage,
  onExportText,
}: {
  selectionMode: SelectionMode;
  selectedCount: number;
  hasSelection: boolean;
  allSelected: boolean;
  sharing: boolean;
  exporting: boolean;
  favoriteLoading: boolean;
  onCancel: () => void;
  onSelectAll: () => void;
  onConfirmShare: () => void;
  onConfirmFavorite: () => void;
  onExportImage: () => void;
  onExportText: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-0 left-0 right-0 z-[80] flex flex-wrap items-center justify-center gap-3 px-4 pb-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
      <ActionBar>
        <ActionBarGroup>
          <ActionBarButton onClick={onSelectAll}>
            <SquareCheck className="w-4 h-4" />
            {allSelected ? t("chat.action.deselectAll") : t("chat.action.selectAll")}
          </ActionBarButton>
          <span className="px-1 text-sm text-text-secondary">
            {t("chat.selection.selectedCount", { count: String(selectedCount) })}
          </span>
          <ActionBarButton onClick={onCancel}>
            <X className="w-3.5 h-3.5" />
            {t("chat.action.cancel")}
          </ActionBarButton>
        </ActionBarGroup>
      </ActionBar>

      {selectionMode === "favorite" && (
        <ActionBar>
          <ActionBarButton onClick={onConfirmFavorite} disabled={!hasSelection || favoriteLoading} variant="primary">
            <Star className="w-3.5 h-3.5" />
            {favoriteLoading ? t("chat.action.favoriting") : t("chat.action.favoriteSelected")}
          </ActionBarButton>
        </ActionBar>
      )}

      {selectionMode === "share" && (
        <ActionBar>
          <ExportDropdown
            onExportImage={onExportImage}
            onExportText={onExportText}
            disabled={!hasSelection || exporting}
            exporting={exporting}
          />
          <ActionBarButton onClick={onConfirmShare} disabled={!hasSelection || sharing} variant="primary">
            <Share2 className="w-3.5 h-3.5" />
            {sharing ? t("chat.action.generating") : t("chat.action.generateShareLink")}
          </ActionBarButton>
        </ActionBar>
      )}
    </div>
  );
}
