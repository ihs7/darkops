import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, stateDir, writeJson } from "./store";

export interface NavCacheEntry {
  key: string;
  model: string;
  createdAt: string;
  value: unknown;
}

export type NavCache = Record<string, NavCacheEntry>;

export type NavKind = "rank" | "score";

export const NAV_CACHE_LIMIT = 2000;

export function navKey(kind: NavKind, model: string, intent: string, payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind, model, intent, payload }))
    .digest("hex")
    .slice(0, 32);
}

export function readNav<T>(cache: NavCache, key: string): T | undefined {
  return cache[key]?.value as T | undefined;
}

export function writeNav(cache: NavCache, key: string, model: string, value: unknown): void {
  cache[key] = { key, model, createdAt: new Date().toISOString(), value };
}

export function pruneNavCache(cache: NavCache, limit: number = NAV_CACHE_LIMIT): NavCache {
  const entries = Object.values(cache).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const next: NavCache = {};
  for (const entry of entries.slice(0, limit)) next[entry.key] = entry;
  return next;
}

export function navCachePath(root: string): string {
  return join(stateDir(root), "nav-cache.json");
}

export async function loadNavCache(root: string): Promise<NavCache> {
  return (await readJson<NavCache>(navCachePath(root))) ?? {};
}

export async function saveNavCache(root: string, cache: NavCache): Promise<void> {
  await writeJson(navCachePath(root), pruneNavCache(cache));
}
