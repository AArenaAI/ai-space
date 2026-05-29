export type BackgroundTaskType = "image" | "video" | "chat";
export type BackgroundTaskStatus = "pending" | "succeeded" | "failed" | "completed" | "cancelled" | "incomplete";

export interface BackgroundTaskRecord {
  key: string;
  type: BackgroundTaskType;
  id: string | number;
  title: string;
  description?: string;
  href: string;
  status: "pending" | "done";
  createdAt: number;
  updatedAt: number;
  conversationId?: number;
  serverMessageId?: number;
  conversationTitle?: string;
}

export interface TaskFinishedNotification {
  key: string;
  type: BackgroundTaskType;
  title: string;
  description?: string;
  href: string;
  ok: boolean;
  conversationTitle?: string;
}

const STORAGE_KEY = "ai-space-background-tasks";
const DONE_KEY = "ai-space-background-task-done";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readTasks(): BackgroundTaskRecord[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: BackgroundTaskRecord[]) {
  if (!canUseStorage()) return;
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const next = tasks
      .filter((task) => task.status === "pending" || task.updatedAt > cutoff)
      .slice(-80);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("background-tasks-changed"));
  } catch {
    // ignore storage errors
  }
}

export function getBackgroundTasks() {
  return readTasks();
}

export function getPendingBackgroundTasks() {
  return readTasks().filter((task) => task.status === "pending");
}

export function clearPendingBackgroundTasks() {
  const tasks = readTasks().filter((task) => task.status !== "pending");
  writeTasks(tasks);
}

export function registerBackgroundTask(task: Omit<BackgroundTaskRecord, "key" | "status" | "createdAt" | "updatedAt"> & { key?: string }) {
  if (!canUseStorage()) return;
  const now = Date.now();
  const key = task.key || `${task.type}:${task.id}`;
  const tasks = readTasks();
  const existingIndex = tasks.findIndex((item) => item.key === key);
  const record: BackgroundTaskRecord = {
    ...task,
    key,
    status: "pending",
    createdAt: existingIndex >= 0 ? tasks[existingIndex].createdAt : now,
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    tasks[existingIndex] = { ...tasks[existingIndex], ...record };
  } else {
    tasks.push(record);
  }
  writeTasks(tasks);
}

export function completeBackgroundTask(key: string) {
  const tasks = readTasks();
  const idx = tasks.findIndex((task) => task.key === key);
  if (idx < 0) return;
  tasks[idx] = { ...tasks[idx], status: "done", updatedAt: Date.now() };
  writeTasks(tasks);
}

export function completeBackgroundTaskSilently(key: string) {
  rememberNotified(key);
  completeBackgroundTask(key);
}

function hasNotified(key: string) {
  if (!canUseStorage()) return false;
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const keys = raw ? JSON.parse(raw) : [];
    return Array.isArray(keys) && keys.includes(key);
  } catch {
    return false;
  }
}

function rememberNotified(key: string) {
  if (!canUseStorage()) return;
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const keys = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(keys) ? keys.filter((item) => typeof item === "string") : [];
    if (!next.includes(key)) next.push(key);
    localStorage.setItem(DONE_KEY, JSON.stringify(next.slice(-200)));
  } catch {
    // ignore storage errors
  }
}

export function emitTaskFinished(notification: TaskFinishedNotification) {
  if (typeof window === "undefined") return;
  if (hasNotified(notification.key)) return;
  rememberNotified(notification.key);
  completeBackgroundTask(notification.key);
  window.dispatchEvent(new CustomEvent<TaskFinishedNotification>("background-task-finished", { detail: notification }));
}

export function buildTaskCompletionCopy(task: BackgroundTaskRecord, ok: boolean): TaskFinishedNotification {
  const noun = task.type === "image" ? "图片" : task.type === "video" ? "视频" : "对话";
  const description = task.type === "chat"
    ? task.conversationTitle || task.description || "点击查看对话详情"
    : task.description || task.title;
  return {
    key: task.key,
    type: task.type,
    title: ok ? `${noun}任务已完成` : `${noun}任务未完成`,
    description,
    href: task.href,
    ok,
    conversationTitle: task.conversationTitle,
  };
}
