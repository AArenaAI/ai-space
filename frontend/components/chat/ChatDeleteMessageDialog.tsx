"use client";

import { memo } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export type ChatDeleteMessageDialogProps = {
  targetId: string | null;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  onDelete?: (id: string) => void;
  onClose: () => void;
};

function ChatDeleteMessageDialog({
  targetId,
  title,
  description,
  confirmText,
  cancelText,
  onDelete,
  onClose,
}: ChatDeleteMessageDialogProps) {
  return (
    <ConfirmDialog
      isOpen={!!targetId}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={cancelText}
      variant="danger"
      onConfirm={() => {
        if (targetId && onDelete) onDelete(targetId);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

export default memo(ChatDeleteMessageDialog);
