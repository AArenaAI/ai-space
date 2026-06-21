export interface RefreshedVideoGeneration {
  id: number;
  prompt: string;
  model: string;
  ratio: string;
  duration: number;
  generate_audio: boolean;
  watermark: boolean;
  task_id: string;
  status: string;
  video_url: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

type RefreshOk = { kind: "ok"; video: RefreshedVideoGeneration };
type RefreshSkipped = { kind: "skipped" | "rate_limited" | "error"; status?: number };
export type VideoRefreshResult = RefreshOk | RefreshSkipped;

// The backend refresh endpoint is globally rate-limited. Seedream can submit several
// shot videos at once, so treat refresh as a single global queue instead of per-card polling.
const MIN_GLOBAL_REFRESH_GAP_MS = 35_000;
const MIN_SAME_VIDEO_REFRESH_GAP_MS = 120_000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 180_000;

let queue: Promise<void> = Promise.resolve();
let nextGlobalRefreshAt = 0;
let rateLimitedUntil = 0;
const lastRefreshByVideoId = new Map<number, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res: Response) {
  const raw = res.headers.get("retry-after");
  if (!raw) return DEFAULT_RATE_LIMIT_BACKOFF_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(DEFAULT_RATE_LIMIT_BACKOFF_MS, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(DEFAULT_RATE_LIMIT_BACKOFF_MS, date - Date.now());
  return DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

async function runQueued<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function refreshVideoTaskThrottled(
  id: number,
  headers: Record<string, string>,
): Promise<VideoRefreshResult> {
  const now = Date.now();
  if (now < rateLimitedUntil) return { kind: "rate_limited", status: 429 };

  const lastSameVideoAt = lastRefreshByVideoId.get(id) || 0;
  if (now - lastSameVideoAt < MIN_SAME_VIDEO_REFRESH_GAP_MS) {
    return { kind: "skipped" };
  }

  return runQueued(async () => {
    const queuedNow = Date.now();
    if (queuedNow < rateLimitedUntil) return { kind: "rate_limited", status: 429 } as const;

    const waitMs = Math.max(0, nextGlobalRefreshAt - queuedNow, lastSameVideoAt + MIN_SAME_VIDEO_REFRESH_GAP_MS - queuedNow);
    if (waitMs > 0) await sleep(waitMs);

    const res = await fetch(`/api/videos/${id}/refresh`, {
      credentials: "include",
      headers,
    });

    const finishedAt = Date.now();
    lastRefreshByVideoId.set(id, finishedAt);
    nextGlobalRefreshAt = finishedAt + MIN_GLOBAL_REFRESH_GAP_MS;

    if (res.status === 429) {
      rateLimitedUntil = finishedAt + parseRetryAfterMs(res);
      return { kind: "rate_limited", status: 429 };
    }
    if (!res.ok) return { kind: "error", status: res.status };

    const video: RefreshedVideoGeneration = await res.json();
    return { kind: "ok", video };
  });
}
