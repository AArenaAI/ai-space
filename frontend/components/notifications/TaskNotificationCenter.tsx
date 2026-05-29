"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BackgroundTaskRecord,
  buildTaskCompletionCopy,
  clearPendingBackgroundTasks,
  emitTaskFinished,
  getPendingBackgroundTasks,
  TaskFinishedNotification,
} from "@/lib/taskNotifications";
import TaskToastCard from "@/components/notifications/TaskToastCard";

class AuthExpiredError extends Error {}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ensureTaskResponse(res: Response) {
  if (res.status === 401) {
    throw new AuthExpiredError("task notification auth expired");
  }
  return res.ok;
}

function isTerminal(status?: string) {
  return ["succeeded", "failed", "completed", "cancelled", "incomplete"].includes(status || "");
}

function isOk(status?: string, hasContent = true) {
  return status === "succeeded" || status === "completed" || (status === "" && hasContent);
}

async function checkTask(task: BackgroundTaskRecord): Promise<{ done: boolean; ok: boolean } | null> {
  if (task.type === "image") {
    if (task.conversationId && task.serverMessageId && task.href.startsWith("/image/chat")) {
      const res = await fetch(`/api/image-chats/${task.conversationId}/messages`, { headers: getAuthHeaders() });
      if (!(await ensureTaskResponse(res))) return null;
      const data = await res.json().catch(() => ({}));
      const message = Array.isArray(data.messages) ? data.messages.find((item: any) => String(item.id) === String(task.serverMessageId)) : null;
      if (!message) return null;
      const status = message.status || "";
      const hasImage = Boolean(message.image_url || message.partial_image_url);
      return { done: isTerminal(status), ok: status === "completed" && hasImage };
    }

    const res = await fetch("/api/images", { headers: getAuthHeaders() });
    if (!(await ensureTaskResponse(res))) return null;
    const data = await res.json().catch(() => ({}));
    const image = Array.isArray(data.images) ? data.images.find((item: any) => String(item.id) === String(task.id)) : null;
    if (!image) return null;
    return { done: isTerminal(image.status), ok: isOk(image.status, !!image.image_url) };
  }

  if (task.type === "video") {
    if (task.conversationId && task.serverMessageId && task.href.startsWith("/video/chat")) {
      const res = await fetch(`/api/video-chats/${task.conversationId}/messages`, { headers: getAuthHeaders() });
      if (!(await ensureTaskResponse(res))) return null;
      const data = await res.json().catch(() => ({}));
      const message = Array.isArray(data.messages) ? data.messages.find((item: any) => String(item.id) === String(task.serverMessageId)) : null;
      if (!message) return null;
      const status = message.status || "";
      return { done: isTerminal(status), ok: ["succeeded", "completed"].includes(status) && Boolean(message.video_url) };
    }

    const res = await fetch(`/api/videos/${task.id}/refresh`, { credentials: "include", headers: getAuthHeaders() });
    if (!(await ensureTaskResponse(res))) return null;
    const video = await res.json().catch(() => ({}));
    return { done: isTerminal(video.status), ok: isOk(video.status, !!video.video_url) };
  }

  if (task.type === "chat") {
    if (!task.conversationId || !task.serverMessageId) return null;
    const res = await fetch(`/api/conversations/${task.conversationId}/messages/${task.serverMessageId}`, { headers: getAuthHeaders() });
    if (!(await ensureTaskResponse(res))) return null;
    const data = await res.json().catch(() => ({}));
    const status = data?.background_task?.status || "";
    const content = data?.message?.content || "";
    if (status) {
      return { done: isTerminal(status) && (status !== "completed" || content.trim().length > 0), ok: status === "completed" && content.trim().length > 0 };
    }
    return { done: content.trim().length > 0, ok: content.trim().length > 0 };
  }

  return null;
}

function showTaskToast(notification: TaskFinishedNotification, router: ReturnType<typeof useRouter>) {
  toast.custom(
    (id) => (
      <TaskToastCard
        notification={notification}
        onClick={() => {
          toast.dismiss(id);
          router.push(notification.href);
        }}
      />
    ),
    {
      duration: 15000,
      position: "top-right",
      unstyled: true,
      testId: "aispace-task-toast",
      className: "!m-0 !border-0 !bg-transparent !p-0 !shadow-none !ring-0",
      style: { background: "transparent", border: "0", boxShadow: "none", padding: 0 },
    }
  );
}

export default function TaskNotificationCenter() {
  const router = useRouter();
  const checkingRef = useRef(false);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<TaskFinishedNotification>).detail;
      if (detail) showTaskToast(detail, router);
    };
    window.addEventListener("background-task-finished", onFinished);
    return () => window.removeEventListener("background-task-finished", onFinished);
  }, [router]);

  useEffect(() => {
    let stopped = false;

    const scan = async () => {
      if (checkingRef.current || stopped) return;
      const tasks = getPendingBackgroundTasks();
      if (tasks.length === 0) return;
      checkingRef.current = true;
      try {
        for (const task of tasks) {
          if (stopped) break;
          try {
            const result = await checkTask(task);
            if (result?.done) {
              emitTaskFinished(buildTaskCompletionCopy(task, result.ok));
            }
          } catch (error) {
            if (error instanceof AuthExpiredError) {
              clearPendingBackgroundTasks();
              break;
            }
            // 单个任务查询失败不影响其它任务
          }
        }
      } finally {
        checkingRef.current = false;
      }
    };

    const onTasksChanged = () => scan();
    window.addEventListener("background-tasks-changed", onTasksChanged);
    const timer = window.setInterval(scan, 2000);
    scan();

    return () => {
      stopped = true;
      window.removeEventListener("background-tasks-changed", onTasksChanged);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
