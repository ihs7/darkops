import type { ComplexityFacts } from "../harness/complexity";
import type { SourceUnit } from "../harness/discover";
import type { UnitGraph } from "../harness/graph";
import type { FileHistory } from "../harness/history";
import { adapterFor } from "../harness/languages";
import { percentileRanks, policy, scoreUnit, type ComputedSignals } from "../jev/policy";
import type { WideAnswers } from "../jev/questions";
import type { RunRecord, RunUnit } from "../state/store";

export const EMPTY_GRAPH: UnitGraph = {
  fanIn: 0,
  fanOut: 0,
  imports: [],
  dependents: [],
  typeImports: 0,
  exports: [],
  typeExports: 0,
};

export const EMPTY_COMPUTED: ComputedSignals = { churn: 0, defect: 0, complexity: 0 };

export function computeSignals(
  targets: readonly SourceUnit[],
  history: ReadonlyMap<string, FileHistory>,
  complexity: ReadonlyMap<string, ComplexityFacts>,
): Map<string, ComputedSignals> {
  const scale = policy.scale;
  const churn = percentileRanks(
    targets.map((unit) => history.get(unit.relPath)?.recentCommits ?? 0),
  );
  const defect = percentileRanks(
    targets.map((unit) => history.get(unit.relPath)?.bugFixCommits ?? 0),
  );
  const cx = percentileRanks(
    targets.map((unit) => complexity.get(unit.relPath)?.maxCyclomatic ?? 0),
  );

  const signals = new Map<string, ComputedSignals>();
  targets.forEach((unit, index) => {
    signals.set(unit.relPath, {
      churn: (churn[index] ?? 0) * scale,
      defect: (defect[index] ?? 0) * scale,
      complexity: (cx[index] ?? 0) * scale,
    });
  });
  return signals;
}

export function countUnits(results: RunUnit[], skipped: number): RunRecord["counts"] {
  const failed = results.filter((unit) => Boolean(unit.error)).length;
  return {
    total: results.length,
    scored: results.length - failed,
    failed,
    skipped,
  };
}

export function buildUnit(
  unit: SourceUnit,
  graph: UnitGraph,
  history: FileHistory | null,
  complexity: ComplexityFacts,
  computed: ComputedSignals,
  answers: WideAnswers,
): RunUnit {
  const scored = scoreUnit(answers, computed);
  return {
    ...baseUnit(unit, graph, history, complexity),
    priority: scored.priority,
    confidence: scored.confidence,
    drivers: scored.drivers,
    uncertain: scored.uncertain,
    signals: scored.signals,
    answers,
  };
}

export function failedUnit(
  unit: SourceUnit,
  graph: UnitGraph,
  history: FileHistory | null,
  complexity: ComplexityFacts,
  error: unknown,
): RunUnit {
  return {
    ...baseUnit(unit, graph, history, complexity),
    priority: 0,
    confidence: 0,
    drivers: [],
    uncertain: [],
    signals: null,
    answers: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

type BaseUnit = Omit<
  RunUnit,
  "priority" | "confidence" | "drivers" | "uncertain" | "signals" | "answers"
>;

function baseUnit(
  unit: SourceUnit,
  graph: UnitGraph,
  history: FileHistory | null,
  complexity: ComplexityFacts,
): BaseUnit {
  return {
    relPath: unit.relPath,
    kind: unit.kind,
    language: adapterFor(unit.relPath)?.id,
    bytes: unit.bytes,
    hash: unit.hash,
    graph,
    history,
    complexity,
  };
}
