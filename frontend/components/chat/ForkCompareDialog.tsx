"use client";

import { useState } from "react";
import { Columns2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ChatModel {
  id: string;
  name: string;
  color?: string;
}

interface ForkCompareDialogProps {
  open: boolean;
  onClose: () => void;
  models: ChatModel[];
  currentModelId?: string;
  onConfirm: (modelIds: string[]) => void;
}

export default function ForkCompareDialog({ open, onClose, models, currentModelId, onConfirm }: ForkCompareDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);

  if (!open) return null;

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((m) => m !== id);
      }
      if (prev.length >= 3) {
        toast.warning("最多选择3个模型");
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleConfirm = () => {
    if (selected.length === 0) {
      toast.error("请至少选择一个模型");
      return;
    }
    onConfirm(selected);
    setSelected([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-elevated border border-surface-border rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Columns2 className="w-5 h-5 text-brand" />
            <h3 className="text-base font-semibold text-text-primary">选择对比模型</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-card text-text-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          选择要与当前模型对比的其他模型（最多3个）
        </p>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {models.map((model) => {
            const isCurrent = model.id === currentModelId;
            const isSelected = selected.includes(model.id);
            return (
              <button
                key={model.id}
                onClick={() => !isCurrent && toggleModel(model.id)}
                disabled={isCurrent}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left",
                  isCurrent
                    ? "border-surface-border bg-surface-card/50 opacity-50 cursor-not-allowed"
                    : isSelected
                    ? "border-brand bg-brand/5"
                    : "border-surface-border bg-surface-card hover:border-brand/30"
                )}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ backgroundColor: model.color || "#666" }}
                >
                  {model.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="text-sm text-text-primary flex-1">{model.name}</span>
                {isCurrent && <span className="text-xs text-text-tertiary">当前</span>}
                {isSelected && !isCurrent && (
                  <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-surface-border text-sm text-text-secondary hover:bg-surface-card transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected.length === 0}
            className={cn(
              "flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
              selected.length > 0
                ? "bg-brand text-white hover:bg-brand/90"
                : "bg-surface-card text-text-tertiary cursor-not-allowed"
            )}
          >
            开始对比
          </button>
        </div>
      </div>
    </div>
  );
}
