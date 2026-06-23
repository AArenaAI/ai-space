import type { CachedConversationSnapshot } from "@/lib/chatConversationCache";
import { setConversationSnapshot } from "@/lib/chatConversationCache";

const DB_NAME = "ai-space-chat-snapshot-cache";
const DB_VERSION = 3;
const STORE_NAME = "conversationSnapshots";
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let maxEntries = DEFAULT_MAX_ENTRIES;
let ttlMs = DEFAULT_TTL_MS;

export type PersistentConversationSnapshotRecord = Omit<CachedConversationSnapshot, "groupViews"> & {
  cacheKey: string;
  ownerKey: string;
  groupViews: [number, number][];
  savedAt: number;
};

type PersistentConversationSnapshotStorage = {
  get(cacheKey: string): Promise<PersistentConversationSnapshotRecord | undefined>;
  set(record: PersistentConversationSnapshotRecord): Promise<void>;
  delete(cacheKey: string): Promise<void>;
  clear(): Promise<void>;
  list(): Promise<PersistentConversationSnapshotRecord[]>;
};

let testStorage: PersistentConversationSnapshotStorage | undefined;
let dbPromise: Promise<IDBDatabase> | undefined;

function nowMs() {
  return Date.now();
}

function isBrowserIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function resolvePersistentConversationOwnerKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const rawUser = window.localStorage.getItem("user");
    if (!rawUser) return undefined;
    const user = JSON.parse(rawUser);
    const id = user?.id ?? user?.email;
    return id === undefined || id === null || String(id).trim() === "" ? undefined : `user:${String(id)}`;
  } catch {
    return undefined;
  }
}

function buildPersistentConversationCacheKey(ownerKey: string, conversationId: number): string {
  return `${ownerKey}:conversation:${conversationId}`;
}

function isExpired(record: PersistentConversationSnapshotRecord, now = nowMs()): boolean {
  return now - record.updatedAt > ttlMs;
}

function serializeSnapshot(snapshot: CachedConversationSnapshot, ownerKey: string): PersistentConversationSnapshotRecord {
  return {
    ...snapshot,
    cacheKey: buildPersistentConversationCacheKey(ownerKey, snapshot.conversationId),
    ownerKey,
    messages: snapshot.messages.map((message) => ({
      ...message,
      files: message.files ? message.files.map((file) => ({ ...file })) : undefined,
      searchSources: message.searchSources ? message.searchSources.map((source) => ({ ...source })) : undefined,
      groupModels: message.groupModels ? [...message.groupModels] : undefined,
      statusTimeline: message.statusTimeline ? message.statusTimeline.map((step) => ({ ...step })) : undefined,
      activityStatus: message.activityStatus ? { ...message.activityStatus } : undefined,
    })),
    groupViews: Array.from(snapshot.groupViews.entries()),
    compareModels: [...snapshot.compareModels],
    savedAt: nowMs(),
  };
}

function deserializeRecord(record: PersistentConversationSnapshotRecord): CachedConversationSnapshot {
  return {
    ...record,
    messages: record.messages.map((message) => ({
      ...message,
      files: message.files ? message.files.map((file) => ({ ...file })) : undefined,
      searchSources: message.searchSources ? message.searchSources.map((source) => ({ ...source })) : undefined,
      groupModels: message.groupModels ? [...message.groupModels] : undefined,
      statusTimeline: message.statusTimeline ? message.statusTimeline.map((step) => ({ ...step })) : undefined,
      activityStatus: message.activityStatus ? { ...message.activityStatus } : undefined,
    })),
    groupViews: new Map(record.groupViews),
    compareModels: [...record.compareModels],
  };
}

function openDb(): Promise<IDBDatabase> {
  if (!isBrowserIndexedDbAvailable()) return Promise.reject(new Error("indexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      store.createIndex("ownerKey", "ownerKey");
      store.createIndex("conversationId", "conversationId");
      store.createIndex("updatedAt", "updatedAt");
      store.createIndex("savedAt", "savedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("open indexedDB failed"));
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
    tx.onerror = () => reject(tx.error || new Error("indexedDB transaction failed"));
  });
}

const indexedDbStorage: PersistentConversationSnapshotStorage = {
  async get(conversationId) {
    return await withStore<PersistentConversationSnapshotRecord | undefined>("readonly", (store) => store.get(conversationId));
  },
  async set(record) {
    await withStore<IDBValidKey>("readwrite", (store) => store.put(record));
  },
  async delete(conversationId) {
    await withStore<undefined>("readwrite", (store) => store.delete(conversationId));
  },
  async clear() {
    await withStore<undefined>("readwrite", (store) => store.clear());
  },
  async list() {
    return await withStore<PersistentConversationSnapshotRecord[]>("readonly", (store) => store.getAll());
  },
};

function storage(): PersistentConversationSnapshotStorage | undefined {
  if (testStorage) return testStorage;
  return isBrowserIndexedDbAvailable() ? indexedDbStorage : undefined;
}

async function prunePersistentConversationSnapshots() {
  const store = storage();
  if (!store) return;
  const records = await store.list();
  const now = nowMs();
  const expired = records.filter((record) => isExpired(record, now));
  await Promise.all(expired.map((record) => store.delete(record.cacheKey)));
  const fresh = records.filter((record) => !isExpired(record, now));
  if (fresh.length <= maxEntries) return;
  const overflow = fresh
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, fresh.length - maxEntries);
  await Promise.all(overflow.map((record) => store.delete(record.cacheKey)));
}

export function configurePersistentConversationSnapshotCache(options: { maxEntries?: number; ttlMs?: number }) {
  maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS);
}

export function resetPersistentConversationSnapshotCacheConfig() {
  maxEntries = DEFAULT_MAX_ENTRIES;
  ttlMs = DEFAULT_TTL_MS;
  testStorage = undefined;
}

export function configurePersistentConversationSnapshotStorageForTests(storageOverride: PersistentConversationSnapshotStorage | undefined) {
  testStorage = storageOverride;
}

export async function getPersistentConversationSnapshot(conversationId: number): Promise<CachedConversationSnapshot | undefined> {
  const store = storage();
  if (!store) return undefined;
  const ownerKey = resolvePersistentConversationOwnerKey();
  if (!ownerKey) return undefined;
  const cacheKey = buildPersistentConversationCacheKey(ownerKey, conversationId);
  try {
    const record = await store.get(cacheKey);
    if (!record) return undefined;
    if (record.ownerKey !== ownerKey) {
      await store.delete(cacheKey);
      return undefined;
    }
    if (isExpired(record)) {
      await store.delete(cacheKey);
      return undefined;
    }
    const touched = { ...record, updatedAt: nowMs() };
    await store.set(touched);
    const snapshot = deserializeRecord(touched);
    setConversationSnapshot(snapshot);
    return snapshot;
  } catch {
    return undefined;
  }
}

export async function setPersistentConversationSnapshot(snapshot: CachedConversationSnapshot): Promise<void> {
  const store = storage();
  if (!store) return;
  const ownerKey = resolvePersistentConversationOwnerKey();
  if (!ownerKey) return;
  try {
    await store.set(serializeSnapshot({ ...snapshot, updatedAt: nowMs() }, ownerKey));
    await prunePersistentConversationSnapshots();
  } catch {
    // Persistent cache is an acceleration layer only; never fail chat restore because IndexedDB failed.
  }
}

export async function deletePersistentConversationSnapshot(conversationId: number | undefined | null): Promise<void> {
  if (typeof conversationId !== "number") return;
  const store = storage();
  if (!store) return;
  const ownerKey = resolvePersistentConversationOwnerKey();
  if (!ownerKey) return;
  try {
    await store.delete(buildPersistentConversationCacheKey(ownerKey, conversationId));
  } catch {}
}

export async function clearPersistentConversationSnapshotCache(): Promise<void> {
  const store = storage();
  if (!store) return;
  try {
    await store.clear();
  } catch {}
}
