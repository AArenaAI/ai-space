"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function InputDialog({
  isOpen,
  title,
  description,
  defaultValue = "",
  placeholder = "",
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultValue]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-[360px] mx-4 rounded-2xl bg-surface-elevated border border-surface-border shadow-2xl p-6 animate-dialog-appear"
      >
        <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-text-secondary mb-4 leading-relaxed">{description}</p>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 rounded-xl bg-surface-card border border-surface-border text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-brand/50 transition-colors mb-5"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary bg-surface-card border border-surface-border hover:bg-surface-elevated transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
