import type { CompiledMap, CompiledNode } from "./compile";
import { buildShortlist, judgeShortlist, rankOpportunities } from "./shortlist";
import { resolveOptions, walkFrontier, type FoundUnit } from "./walk";
import type { Candidate } from "./strategies";

export const STOP = "__stop__";

export interface StepChoice {
  probabilities: Record<string, number>;
  choice: string;
  confidence: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export type RankOptions = (
  intent: string,
  node: CompiledNode,
  candidates: Candidate[],
) => Promise<StepChoice>;

export interface SearchProgress {
  step: number;
  budget: number;
  path: string;
  confidence: number;
}

export interface RelevanceJudgment {
  relevance: number;
  confidence: number;
}

export interface RelevanceResult {
  judgments: Map<string, RelevanceJudgment>;
  usage: { inputTokens: number; outputTokens: number };
}

export type ScoreRelevance = (intent: string, paths: string[]) => Promise<RelevanceResult>;

export interface SearchStep {
  from: string;
  chosen: string;
  confidence: number;
  strategy?: string;
  relation?: string;
}

export interface Opportunity {
  path: string;
  relevance: number;
  relevanceConfidence: number;
  priority: number;
  drivers: string[];
  confidence: number;
  trail: SearchStep[];
}

export interface SearchOptions {
  rank: RankOptions;
  score?: ScoreRelevance;
  onStep?: (progress: SearchProgress) => void;
  limit?: number;
  budget?: number;
  minConfidence?: number;
  target?: number;
  lookahead?: number;
  maxDescend?: number;
  maxRelated?: number;
  maxSymbols?: number;
  scoringLimit?: number;
  branch?: number;
  coverage?: number;
}

export interface SearchResult {
  intent: string;
  opportunities: Opportunity[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  stop: "budget" | "exhausted";
}

export async function search(
  map: CompiledMap,
  intent: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const config = resolveOptions(options);
  const found: FoundUnit[] = [];
  const walk = await walkFrontier(map, intent, config, found);
  const shortlist = buildShortlist(found, map, config.scoringLimit, config.coverage);
  const scored = await judgeShortlist(config.score, intent, shortlist);

  return {
    intent,
    opportunities: rankOpportunities(shortlist, scored.judgments, config.limit),
    steps: walk.steps,
    usage: {
      inputTokens: walk.usage.inputTokens + scored.usage.inputTokens,
      outputTokens: walk.usage.outputTokens + scored.usage.outputTokens,
    },
    stop: walk.stop,
  };
}
