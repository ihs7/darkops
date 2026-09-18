import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { analyzeComplexity, EMPTY_COMPLEXITY, type ComplexityFacts } from "../harness/complexity";
import { discoverSourceUnits, headCommit, type SourceUnit } from "../harness/discover";
import { buildGraph, type UnitGraph } from "../harness/graph";
import { collectHistory, type FileHistory } from "../harness/history";
import { createReviewer, type Reviewer } from "../jev/client";
import type { ComputedSignals } from "../jev/policy";
import type { Progress } from "../report/progress";
import {
  answerKey,
  ensureState,
  loadCache,
  pruneCache,
  repositoryFingerprint,
  runsDir,
  saveCache,
  stateDir,
  stateFingerprint,
  writeJson,
  type Cache,
  type RunRecord,
  type RunUnit,
  type RunUsage,
} from "../state/store";
import { mapWithConcurrency } from "../util/pool";
import {
  buildUnit,
  computeSignals,
  countUnits,
  EMPTY_COMPUTED,
  EMPTY_GRAPH,
  failedUnit,
} from "./units";

export interface ScanOptions {
  root: string;
  concurrency: number;
  maxBytes: number;
  force: boolean;
  model?: string;
  progress?: Progress;
}

export async function runScan(options: ScanOptions): Promise<RunRecord> {
  await ensureState(options.root);

  const progress = options.progress;
  const startedAt = new Date().toISOString();
  progress?.phase("discovering source units");
  const { units, skipped, mode } = await discoverSourceUnits({
    root: options.root,
    maxBytes: options.maxBytes,
  });
  const fingerprint = repositoryFingerprint(units, skipped);
  const commit = await headCommit(options.root);
  const targets = units.filter((unit) => unit.kind === "source");
  progress?.phase("reading history and graph");
  const { graph } = await buildGraph(units, { root: options.root });
  const history = await collectHistory({
    root: options.root,
    paths: new Set(units.map((unit) => unit.relPath)),
  });
  const complexity = new Map<string, ComplexityFacts>(
    targets.map((unit) => [unit.relPath, analyzeComplexity(unit.content, unit.relPath)]),
  );
  const computed = computeSignals(targets, history.files, complexity);

  const reviewer = createReviewer({ model: options.model });
  const cache: Cache = options.force ? {} : await loadCache(options.root);
  const usage: RunUsage = { calls: 0, cached: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  const state: ReviewState = {
    reviewer,
    cache,
    usedKeys: new Set<string>(),
    requestedModel: reviewer.model,
    usage,
    model: reviewer.model,
  };

  progress?.phase("reviewing", { current: 0, total: targets.length });
  let completed = 0;
  const results = await mapWithConcurrency(targets, options.concurrency, async (unit) => {
    const result = await reviewTarget(
      {
        unit,
        graph: graph.get(unit.relPath) ?? EMPTY_GRAPH,
        history: history.files.get(unit.relPath) ?? null,
        complexity: complexity.get(unit.relPath) ?? EMPTY_COMPLEXITY,
        computed: computed.get(unit.relPath) ?? EMPTY_COMPUTED,
      },
      state,
    );
    completed += 1;
    progress?.update({
      current: completed,
      total: targets.length,
      calls: state.usage.calls,
      cached: state.usage.cached,
      failed: state.usage.failed,
      tokens: state.usage.inputTokens,
      file: unit.relPath,
    });
    return result;
  });

  const record: RunRecord = {
    ...runBase(options, {
      startedAt,
      finishedAt: new Date().toISOString(),
      fingerprint,
      commit,
      mode,
      skipped,
    }),
    model: state.model,
    counts: countUnits(results, skipped.length),
    usage,
    units: results,
  };

  await persistRun(options.root, record);
  await saveCache(options.root, pruneCache(cache, state.usedKeys));
  return record;
}

interface TargetContext {
  unit: SourceUnit;
  graph: UnitGraph;
  history: FileHistory | null;
  complexity: ComplexityFacts;
  computed: ComputedSignals;
}

interface ReviewState {
  reviewer: Reviewer;
  cache: Cache;
  usedKeys: Set<string>;
  requestedModel: string;
  usage: RunUsage;
  model: string;
}

async function reviewTarget(context: TargetContext, state: ReviewState): Promise<RunUnit> {
  const { unit, graph, history, complexity, computed } = context;
  const stateKey = stateFingerprint({ graph, history, complexity });
  const key = answerKey({ hash: unit.hash, model: state.requestedModel, state: stateKey });
  const cached = state.cache[key];

  if (cached) {
    state.usage.cached += 1;
    state.usedKeys.add(key);
    state.model = cached.model;
    return buildUnit(unit, graph, history, complexity, computed, cached.answers);
  }

  try {
    const review = await state.reviewer.review(unit, graph, history, complexity);
    state.usage.calls += 1;
    state.usage.inputTokens += review.usage.input_tokens;
    state.usage.outputTokens += review.usage.output_tokens;
    state.model = review.model;
    state.cache[key] = {
      key,
      hash: unit.hash,
      relPath: unit.relPath,
      model: review.model,
      state: stateKey,
      createdAt: new Date().toISOString(),
      answers: review.answers,
    };
    state.usedKeys.add(key);
    return buildUnit(unit, graph, history, complexity, computed, review.answers);
  } catch (error) {
    state.usage.failed += 1;
    return failedUnit(unit, graph, history, complexity, error);
  }
}

interface RunBase {
  startedAt: string;
  finishedAt?: string;
  fingerprint: string;
  commit: string | null;
  mode: RunRecord["mode"];
  skipped: RunRecord["skipped"];
}

function runBase(
  options: ScanOptions,
  base: RunBase,
): Omit<RunRecord, "model" | "counts" | "usage" | "units"> {
  return {
    id: `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    startedAt: base.startedAt,
    finishedAt: base.finishedAt ?? new Date().toISOString(),
    root: options.root,
    mode: base.mode,
    fingerprint: base.fingerprint,
    commit: base.commit,
    skipped: base.skipped,
  };
}

async function persistRun(root: string, record: RunRecord): Promise<void> {
  await writeJson(join(runsDir(root), record.id, "scan.json"), record);
  await writeJson(join(stateDir(root), "latest.json"), {
    id: record.id,
    startedAt: record.startedAt,
  });
}
