import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ComplexityFacts } from "../harness/complexity";
import type { DiscoveryMode, SkippedFile, UnitKind } from "../harness/discover";
import type { UnitGraph } from "../harness/graph";
import type { FileHistory } from "../harness/history";
import type { UnitSignals } from "../jev/policy";
import type { WideAnswers } from "../jev/questions";

export interface RunUnit {
  relPath: string;
  kind: UnitKind;
  language?: string;
  bytes: number;
  hash: string;
  priority: number;
  confidence: number;
  drivers: string[];
  uncertain: string[];
  signals: UnitSignals | null;
  graph: UnitGraph | null;
  history: FileHistory | null;
  complexity: ComplexityFacts | null;
  answers: WideAnswers | null;
  error?: string;
}

export interface RunUsage {
  calls: number;
  cached: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  root: string;
  mode: DiscoveryMode;
  model: string;
  fingerprint?: string;
  commit?: string | null;
  counts: { total: number; scored: number; failed: number; skipped: number };
  usage: RunUsage;
  skipped: SkippedFile[];
  units: RunUnit[];
}

export interface CacheEntry {
  key: string;
  hash: string;
  relPath: string;
  model: string;
  state?: string;
  createdAt: string;
  answers: WideAnswers;
}

export type Cache = Record<string, CacheEntry>;

export {
  answerKey,
  CACHE_VERSION,
  graphFingerprint,
  pruneCache,
  repositoryFingerprint,
  stateFingerprint,
} from "./fingerprints";
export type { AnswerKeyParts, FingerprintUnit, StateFingerprintParts } from "./fingerprints";

export function stateDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.DARKOPS_STATE_DIR) return env.DARKOPS_STATE_DIR;
  const home = env.DARKOPS_HOME || join(homedir(), ".darkops");
  return join(home, "repos", repoKey(root));
}

function repoKey(root: string): string {
  const absolute = resolve(root);
  const name =
    basename(absolute)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo";
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

export function runsDir(root: string): string {
  return join(stateDir(root), "runs");
}

export async function ensureState(root: string): Promise<void> {
  await mkdir(runsDir(root), { recursive: true });
}

export async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function cachePath(root: string): string {
  return join(stateDir(root), "cache.json");
}

export async function loadCache(root: string): Promise<Cache> {
  return (await readJson<Cache>(cachePath(root))) ?? {};
}

export async function saveCache(root: string, cache: Cache): Promise<void> {
  await writeJson(cachePath(root), cache);
}

export async function loadLatestRun(root: string): Promise<RunRecord | null> {
  const pointer = await readJson<{ id: string }>(join(stateDir(root), "latest.json"));
  if (!pointer?.id) return null;
  return readJson<RunRecord>(join(runsDir(root), pointer.id, "scan.json"));
}

export async function loadRun(root: string, runId?: string): Promise<RunRecord | null> {
  if (!runId) return loadLatestRun(root);
  return readJson<RunRecord>(join(runsDir(root), runId, "scan.json"));
}
