import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { estimateCost, type TokenUsage } from "../jev/pricing";
import { readJson, runsDir, type RunRecord } from "../state/store";

export interface UsageRow extends TokenUsage {
  id: string;
  startedAt: string;
  model: string;
  units: number;
  calls: number;
  cached: number;
  failed: number;
  costUsd: number;
}

export async function collectUsage(root: string, limit?: number): Promise<UsageRow[]> {
  const dir = runsDir(root);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const rows: UsageRow[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJson<RunRecord>(join(dir, entry.name, "scan.json"));
    if (!record) continue;
    rows.push({
      id: record.id,
      startedAt: record.startedAt,
      model: record.model,
      units: record.counts.total,
      calls: record.usage.calls,
      cached: record.usage.cached,
      failed: record.usage.failed,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      costUsd: estimateCost(record.usage, record.model),
    });
  }

  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return limit === undefined ? rows : rows.slice(0, limit);
}

export interface UsageTotals extends TokenUsage {
  runs: number;
  calls: number;
  cached: number;
  costUsd: number;
}

export function totalUsage(rows: UsageRow[]): UsageTotals {
  return rows.reduce<UsageTotals>(
    (totals, row) => ({
      runs: totals.runs + 1,
      calls: totals.calls + row.calls,
      cached: totals.cached + row.cached,
      inputTokens: totals.inputTokens + row.inputTokens,
      outputTokens: totals.outputTokens + row.outputTokens,
      costUsd: totals.costUsd + row.costUsd,
    }),
    { runs: 0, calls: 0, cached: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}
