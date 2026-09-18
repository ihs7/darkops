import { createHash } from "node:crypto";
import type { ComplexityFacts } from "../harness/complexity";
import type { UnitGraph } from "../harness/graph";
import type { FileHistory } from "../harness/history";
import type { Cache } from "./store";

export const CACHE_VERSION = 3;

export interface AnswerKeyParts {
  hash: string;
  model: string;
  state?: string;
}

export function answerKey(parts: AnswerKeyParts): string {
  return createHash("sha256")
    .update([CACHE_VERSION, parts.hash, parts.model, parts.state ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function graphFingerprint(graph: UnitGraph): string {
  return createHash("sha256")
    .update([graph.fanIn, graph.fanOut, ...[...graph.dependents].sort()].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export interface StateFingerprintParts {
  graph: UnitGraph;
  history: FileHistory | null;
  complexity: ComplexityFacts;
}

export function stateFingerprint(parts: StateFingerprintParts): string {
  const history = parts.history
    ? {
        commits: parts.history.commits,
        recent: parts.history.recentCommits,
        authors: parts.history.authors,
        primaryShare: Math.round(parts.history.primaryAuthorShare * 100) / 100,
        bugFixes: parts.history.bugFixCommits,
        lastModified: parts.history.lastModified,
        coupledWith: parts.history.couplings.map((coupling) => coupling.path).sort(),
      }
    : null;

  return createHash("sha256")
    .update(
      JSON.stringify({
        graph: graphFingerprint(parts.graph),
        history,
        complexity: parts.complexity,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export interface FingerprintUnit {
  relPath: string;
  hash: string;
}

export function repositoryFingerprint(
  units: readonly FingerprintUnit[],
  skipped: readonly { relPath: string }[],
): string {
  const entries = [
    ...units.map((unit) => `${unit.relPath}:${unit.hash}`),
    ...skipped.map((entry) => `${entry.relPath}:skipped`),
  ].sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 32);
}

export function pruneCache(cache: Cache, keys: ReadonlySet<string>): Cache {
  const next: Cache = {};
  for (const key of keys) {
    const entry = cache[key];
    if (entry) next[key] = entry;
  }
  return next;
}
