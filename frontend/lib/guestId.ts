/**
 * 匿名用户浏览器唯一标识（guest_id）
 * - 首次访问时生成，持久化到 localStorage
 * - 格式: guest_<uuid>
 * - 所有匿名请求通过 X-Guest-ID header 发送给后端
 */

const GUEST_ID_KEY = "guest_id";

function generateGuestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `guest_${crypto.randomUUID()}`;
  }
  return `guest_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function getGuestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = generateGuestId();
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

export function clearGuestId(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GUEST_ID_KEY);
}
