"use client";

import { ArrowUpRight, CheckCircle2, ImageIcon, MessageSquareText, Video, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskFinishedNotification } from "@/lib/taskNotifications";
import { useI18n } from "@/lib/i18n";

function TaskIcon({ type, ok }: { type: TaskFinishedNotification["type"]; ok: boolean }) {
  if (!ok) return <XCircle className="h-4 w-4 text-text-secondary" strokeWidth={1.8} />;
  if (type === "image") return <ImageIcon className="h-4 w-4 text-text-primary" strokeWidth={1.8} />;
  if (type === "video") return <Video className="h-4 w-4 text-text-primary" strokeWidth={1.8} />;
  return <MessageSquareText className="h-4 w-4 text-text-primary" strokeWidth={1.8} />;
}

interface TaskToastCardProps {
  notification: TaskFinishedNotification;
  onClick: () => void;
}

export default function TaskToastCard({ notification, onClick }: TaskToastCardProps) {
  const { t } = useI18n();
  const safeT = (key: string) => {
    const value = t(key);
    return value === key ? "" : value;
  };
  const label = safeT(notification.type === "image" ? "task.type.image" : notification.type === "video" ? "task.type.video" : "task.type.chat") || notification.type;
  const statusText = safeT(notification.ok ? "task.status.done" : "task.status.failed") || (notification.ok ? "Done" : "Failed");
  const fallbackTitle = `${label} ${statusText}`;
  const titleText =
    (notification.type === "image"
      ? safeT(notification.ok ? "image.task.completed" : "image.task.incomplete")
      : notification.type === "video"
        ? safeT(notification.ok ? "video.task.completed" : "video.task.incomplete")
        : "") || fallbackTitle || notification.title?.trim() || "";
  const descriptionText = notification.description?.trim() || "";
  const shouldShowDescription = Boolean(descriptionText && descriptionText !== titleText);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "aispace-task-toast-card group relative w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[22px] text-left transition-all duration-300 ease-out",
        "border border-surface-border/90 bg-surface-card/95 text-text-primary shadow-[0_18px_48px_rgba(15,23,42,0.14),0_2px_10px_rgba(15,23,42,0.07)] backdrop-blur-2xl",
        "dark:shadow-[0_20px_56px_rgba(0,0,0,0.46)]",
        "green:shadow-[0_18px_48px_rgba(53,62,46,0.16),0_2px_10px_rgba(53,62,46,0.08)]",
        "hover:-translate-y-0.5 hover:shadow-[0_24px_64px_rgba(15,23,42,0.18),0_4px_14px_rgba(15,23,42,0.09)] dark:hover:shadow-[0_26px_70px_rgba(0,0,0,0.55)] green:hover:shadow-[0_24px_64px_rgba(53,62,46,0.20),0_4px_14px_rgba(53,62,46,0.10)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.74),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.36),rgba(255,255,255,0.10))] dark:bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.12),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] green:bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.34),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-text-primary/15 to-transparent" />
      <div className="relative flex min-h-[116px]">
        <div className={cn("my-5 ml-5 w-[3px] rounded-full", notification.ok ? "bg-text-primary" : "bg-destructive")} />
        <div className="flex min-w-0 flex-1 gap-3 px-4 py-4 pr-4">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-elevated text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <TaskIcon type={notification.type} ok={notification.ok} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-tertiary">{label}</span>
                  <span className="h-1 w-1 rounded-full bg-text-tertiary/45" />
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-tertiary">
                    {notification.ok ? t("task.status.done") : t("task.status.failed")}
                  </span>
                </div>
                <p className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{titleText}</p>
              </div>
              {notification.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-text-primary/85" strokeWidth={1.8} />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={1.8} />
              )}
            </div>
            {shouldShowDescription && (
              <p className="mt-2 line-clamp-2 text-[13px] font-normal leading-5 text-text-secondary">{descriptionText}</p>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-surface-border/80 pt-3">
              <span className="text-[12px] font-medium text-text-secondary">{t("task.openPage")}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-text-primary text-surface transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.9} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
