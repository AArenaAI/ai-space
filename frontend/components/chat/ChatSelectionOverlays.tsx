"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";
import type { Message } from "@/lib/chatTypes";
import { useI18n } from "@/lib/i18n";
import { SelectionFloatingBar } from "./MessageExportActions";
import TextSelectionFloatingBar, { type TextSelectionFloatingBarState } from "./TextSelectionFloatingBar";

const ShareDialog = dynamic(() => import("@/components/ui/ShareDialog"), { ssr: false });
const MessageExportPreview = dynamic(() => import("./MessageExportPreview"), {
  ssr: false,
  loading: () => null,
});

export type ChatSelectionMode = "share" | "favorite";

export type ChatSelectionOverlaysProps = {
  textSelection: TextSelectionFloatingBarState | null;
  onCopySelectedText: () => void;
  onCopySelectedQuote: () => void;
  selectMode: boolean;
  selectionMode: ChatSelectionMode | null;
  selectedCount: number;
  selectedMessages: Message[];
  allSelected: boolean;
  sharing: boolean;
  exporting: boolean;
  favoriteLoading: boolean;
  shareOpen: boolean;
  shareSlug?: string;
  exportPreviewOpen: boolean;
  exportPreviewCardRef: RefObject<HTMLDivElement>;
  exportCardRef: RefObject<HTMLDivElement>;
  onCancelSelection: () => void;
  onToggleSelectAll: () => void;
  onConfirmShare: () => void;
  onConfirmFavorite: () => void;
  onExportImage: () => void;
  onExportText: () => void;
  onCloseShare: () => void;
  onCloseExportPreview: () => void;
  onDownloadImage: () => void;
};

export default function ChatSelectionOverlays({
  textSelection,
  onCopySelectedText,
  onCopySelectedQuote,
  selectMode,
  selectionMode,
  selectedCount,
  selectedMessages,
  allSelected,
  sharing,
  exporting,
  favoriteLoading,
  shareOpen,
  shareSlug,
  exportPreviewOpen,
  exportPreviewCardRef,
  exportCardRef,
  onCancelSelection,
  onToggleSelectAll,
  onConfirmShare,
  onConfirmFavorite,
  onExportImage,
  onExportText,
  onCloseShare,
  onCloseExportPreview,
  onDownloadImage,
}: ChatSelectionOverlaysProps) {
  const { t } = useI18n();
  const hasSelection = selectedCount > 0;

  return (
    <>
      <TextSelectionFloatingBar
        selection={textSelection}
        copyLabel={t("chat.action.copy")}
        quoteLabel={t("chat.action.copyAsQuote")}
        onCopy={onCopySelectedText}
        onCopyQuote={onCopySelectedQuote}
      />

      {selectMode && selectionMode && (
        <SelectionFloatingBar
          selectionMode={selectionMode}
          selectedCount={selectedCount}
          hasSelection={hasSelection}
          allSelected={allSelected}
          sharing={sharing}
          exporting={exporting}
          favoriteLoading={favoriteLoading}
          onCancel={onCancelSelection}
          onSelectAll={onToggleSelectAll}
          onConfirmShare={onConfirmShare}
          onConfirmFavorite={onConfirmFavorite}
          onExportImage={onExportImage}
          onExportText={onExportText}
        />
      )}

      <ShareDialog isOpen={shareOpen} slug={shareSlug} onClose={onCloseShare} />

      {selectMode && selectedMessages.length > 0 && (
        <MessageExportPreview
          messages={selectedMessages}
          previewOpen={exportPreviewOpen}
          exporting={exporting}
          previewCardRef={exportPreviewCardRef}
          hiddenCardRef={exportCardRef}
          onClose={onCloseExportPreview}
          onDownload={onDownloadImage}
        />
      )}
    </>
  );
}
