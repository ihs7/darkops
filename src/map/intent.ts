import { createNavigator } from "../jev/navigator";
import type { Progress } from "../report/progress";
import { loadNavCache, saveNavCache } from "../state/nav-cache";
import { loadRun } from "../state/store";
import { DarkopsError } from "../util/errors";
import { compileMap, type CompiledMap } from "./compile";
import { search, type Opportunity, type SearchResult } from "./search";
import { defaultResults, statsFor, unitsInScope } from "./scope";
import { buildMap, findNode } from "./tree";

export { defaultResults } from "./scope";

export interface IntentOptions {
  root: string;
  intent: string;
  runId?: string;
  path?: string;
  model?: string;
  fresh?: boolean;
  limit?: number;
  budget?: number;
  minConfidence?: number;
  progress?: Progress;
}

export interface OpportunityStats {
  fanIn: number;
  fanOut: number;
  churn: number;
  defect: number;
  complexity: number;
  bytes: number;
}

export interface IntentOpportunity extends Opportunity {
  stats: OpportunityStats;
}

export interface IntentView {
  runId: string;
  model: string;
  intent: string;
  opportunities: IntentOpportunity[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  stop: SearchResult["stop"];
}

export async function runIntent(options: IntentOptions): Promise<IntentView> {
  const record = await loadRun(options.root, options.runId);
  if (!record) {
    throw new DarkopsError(
      "RUN_MISSING",
      "No scan run found.",
      "Run a query first (the wide pass builds the map automatically).",
    );
  }

  const tree = buildMap(record);
  const map = scope(compileMap(tree, record), options.path, tree);

  const navCache = options.fresh ? {} : await loadNavCache(options.root);
  const navigator = createNavigator({ model: options.model ?? record.model, cache: navCache });
  const limit = options.limit ?? defaultResults(unitsInScope(record, options.path));
  const progress = options.progress;
  progress?.phase("searching the map");
  try {
    const result = await search(map, options.intent, {
      rank: navigator.rank,
      score: navigator.score,
      limit,
      budget: options.budget,
      minConfidence: options.minConfidence,
      onStep: (step) =>
        progress?.update({ current: step.step, total: step.budget, file: step.path }),
    });

    const byPath = new Map(record.units.map((unit) => [unit.relPath, unit]));
    const opportunities = result.opportunities.map((opportunity) => ({
      ...opportunity,
      stats: statsFor(byPath.get(opportunity.path)),
    }));

    return { ...result, opportunities, runId: record.id, model: navigator.model };
  } finally {
    await saveNavCache(options.root, navCache);
    progress?.done();
  }
}

function scope(map: CompiledMap, path: string | undefined, tree: ReturnType<typeof buildMap>) {
  if (!path) return map;
  if (!findNode(tree, path)) throw new DarkopsError("USAGE", `No map node at ${path}.`);
  return { ...map, root: path };
}
