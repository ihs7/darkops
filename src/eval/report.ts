import { estimateCost } from "../jev/pricing";
import type { RunUsage } from "../state/store";

export interface BuildCost {
  calls: number;
  cached: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export interface QueryCost {
  intent: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  stop: "budget" | "exhausted";
  elapsedMs: number;
}

export interface EconomicsReport {
  root: string;
  model: string;
  startedAt: string;
  cold: BuildCost | null;
  warm: BuildCost | null;
  queries: QueryCost[];
}

export interface EconomicsSummary {
  coldInputTokens: number;
  warmInputTokens: number;
  queryInputTokens: number;
  totalInputTokens: number;
  queryMeanTokens: number;
  queryMedianTokens: number;
  warmCacheHitRate: number;
  totalCostUsd: number;
}

export function buildCostFromUsage(usage: RunUsage, elapsedMs: number): BuildCost {
  return {
    calls: usage.calls,
    cached: usage.cached,
    failed: usage.failed,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    elapsedMs,
  };
}

export function summarize(report: EconomicsReport): EconomicsSummary {
  const cold = report.cold?.inputTokens ?? 0;
  const warm = report.warm?.inputTokens ?? 0;
  const queryTokens = report.queries.map((query) => query.inputTokens);
  const queryInputTokens = queryTokens.reduce((sum, value) => sum + value, 0);
  const attempted = (report.warm?.calls ?? 0) + (report.warm?.cached ?? 0);
  const inputTokens = cold + warm + queryInputTokens;
  const outputTokens =
    (report.cold?.outputTokens ?? 0) +
    (report.warm?.outputTokens ?? 0) +
    report.queries.reduce((sum, query) => sum + query.outputTokens, 0);

  return {
    coldInputTokens: cold,
    warmInputTokens: warm,
    queryInputTokens,
    totalInputTokens: inputTokens,
    queryMeanTokens: queryTokens.length > 0 ? queryInputTokens / queryTokens.length : 0,
    queryMedianTokens: median(queryTokens),
    warmCacheHitRate: attempted > 0 ? (report.warm?.cached ?? 0) / attempted : 0,
    totalCostUsd: estimateCost({ inputTokens, outputTokens }, report.model),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
