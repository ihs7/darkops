import type { RunRecord, RunUnit } from "../state/store";
import type { OpportunityStats } from "./intent";

const MIN_RESULTS = 5;
const MAX_RESULTS = 50;
const RESULT_RATIO = 0.05;

export function defaultResults(units: number): number {
  return Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, Math.round(units * RESULT_RATIO)));
}

export function unitsInScope(record: RunRecord, path: string | undefined): number {
  if (!path) return record.units.length;
  return record.units.filter((unit) => unit.relPath === path || unit.relPath.startsWith(`${path}/`))
    .length;
}

export function statsFor(unit: RunUnit | undefined): OpportunityStats {
  return {
    fanIn: unit?.graph?.fanIn ?? 0,
    fanOut: unit?.graph?.fanOut ?? 0,
    churn: unit?.history?.recentCommits ?? 0,
    defect: unit?.history?.bugFixCommits ?? 0,
    complexity: unit?.complexity?.maxCyclomatic ?? 0,
    bytes: unit?.bytes ?? 0,
  };
}
