import type { CompiledMap } from "./compile";
import type {
  RankOptions,
  ScoreRelevance,
  SearchOptions,
  SearchProgress,
  SearchResult,
  SearchStep,
} from "./search";
import { expand } from "./strategies";

const DEFAULT_TARGET = 12;
const DEFAULT_LOOKAHEAD = 2;
const DEFAULT_MAX_DESCEND = 40;
const DEFAULT_MAX_RELATED = 6;
const DEFAULT_MAX_SYMBOLS = 5;
const DEFAULT_SCORING_LIMIT = 32;
const DEFAULT_BRANCH = 8;
const DEFAULT_COVERAGE = 1;
const RETRIEVAL_FLOOR = 1e-6;

export interface FoundUnit {
  path: string;
  priority: number;
  confidence: number;
  drivers: string[];
  retrieval: number;
  trail: SearchStep[];
}

export interface ResolvedSearch {
  rank: RankOptions;
  score?: ScoreRelevance;
  onStep?: (progress: SearchProgress) => void;
  limit: number;
  budget: number;
  minConfidence: number;
  target: number;
  lookahead: number;
  maxDescend: number;
  maxRelated: number;
  maxSymbols: number;
  scoringLimit: number;
  branch: number;
  coverage: number;
}

export interface WalkResult {
  steps: number;
  stop: SearchResult["stop"];
  usage: { inputTokens: number; outputTokens: number };
}

export function resolveOptions(options: SearchOptions): ResolvedSearch {
  const limit = options.limit ?? 5;
  return {
    rank: options.rank,
    score: options.score,
    onStep: options.onStep,
    limit,
    budget: options.budget ?? 12,
    minConfidence: options.minConfidence ?? 0.2,
    target: options.target ?? DEFAULT_TARGET,
    lookahead: options.lookahead ?? DEFAULT_LOOKAHEAD,
    maxDescend: options.maxDescend ?? DEFAULT_MAX_DESCEND,
    maxRelated: options.maxRelated ?? DEFAULT_MAX_RELATED,
    maxSymbols: options.maxSymbols ?? DEFAULT_MAX_SYMBOLS,
    scoringLimit: options.scoringLimit ?? Math.max(DEFAULT_SCORING_LIMIT, limit * 2),
    branch: options.branch ?? DEFAULT_BRANCH,
    coverage: options.coverage ?? DEFAULT_COVERAGE,
  };
}

export async function walkFrontier(
  map: CompiledMap,
  intent: string,
  config: ResolvedSearch,
  found: FoundUnit[],
): Promise<WalkResult> {
  const visited = new Set<string>();
  const frontier: { path: string; score: number; trail: SearchStep[] }[] = [
    { path: map.root, score: 1, trail: [] },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let steps = 0;
  let stop: SearchResult["stop"] = "exhausted";

  while (frontier.length > 0) {
    frontier.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const current = frontier.shift() as { path: string; score: number; trail: SearchStep[] };
    if (visited.has(current.path)) continue;
    visited.add(current.path);

    const node = map.nodes.get(current.path);
    if (!node) continue;

    if (node.kind === "unit") {
      found.push({
        path: node.path,
        priority: node.priority,
        confidence: node.confidence,
        drivers: node.drivers,
        retrieval: current.score,
        trail: current.trail,
      });
      continue;
    }

    if (steps >= config.budget) {
      stop = "budget";
      break;
    }

    const candidates = expand(map, node, visited, {
      target: config.target,
      lookahead: config.lookahead,
      maxDescend: config.maxDescend,
      maxRelated: config.maxRelated,
      maxSymbols: config.maxSymbols,
      intent,
    });
    if (candidates.length === 0) continue;

    steps += 1;
    const decision = await config.rank(intent, node, candidates);
    if (decision.usage) {
      usage.inputTokens += decision.usage.inputTokens;
      usage.outputTokens += decision.usage.outputTokens;
    }
    config.onStep?.({
      step: steps,
      budget: config.budget,
      path: node.path || ".",
      confidence: decision.confidence,
    });
    if (decision.confidence < config.minConfidence) continue;

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        probability: decision.probabilities[candidate.node.path] ?? 0,
      }))
      .filter((entry) => entry.probability > 0)
      .sort(
        (a, b) =>
          b.probability - a.probability ||
          a.candidate.node.path.localeCompare(b.candidate.node.path),
      )
      .slice(0, config.branch);

    for (const entry of ranked) {
      frontier.push({
        path: entry.candidate.node.path,
        score: Math.max(entry.probability, RETRIEVAL_FLOOR),
        trail: [
          ...current.trail,
          {
            from: node.path || ".",
            chosen: entry.candidate.node.path,
            confidence: decision.confidence,
            strategy: entry.candidate.strategy,
            relation: entry.candidate.relation,
          },
        ],
      });
    }
  }

  return { steps, stop, usage };
}
