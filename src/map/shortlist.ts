import type { CompiledMap, CompiledNode } from "./compile";
import type { Opportunity, RelevanceJudgment, RelevanceResult, ScoreRelevance } from "./search";
import type { FoundUnit } from "./walk";

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

export async function judgeShortlist(
  score: ScoreRelevance | undefined,
  intent: string,
  shortlist: FoundUnit[],
): Promise<RelevanceResult> {
  if (!score || shortlist.length === 0) {
    return { judgments: new Map(), usage: { ...NO_USAGE } };
  }
  return score(
    intent,
    shortlist.map((unit) => unit.path),
  );
}

export function rankOpportunities(
  shortlist: FoundUnit[],
  judgments: Map<string, RelevanceJudgment>,
  limit: number,
): Opportunity[] {
  return shortlist
    .map((unit) => {
      const judgment = judgments.get(unit.path);
      return {
        path: unit.path,
        relevance: judgment?.relevance ?? clamp01(unit.retrieval),
        relevanceConfidence: judgment?.confidence ?? 0,
        priority: unit.priority,
        drivers: unit.drivers,
        confidence: unit.confidence,
        trail: unit.trail,
      };
    })
    .filter((opportunity) => opportunity.relevance > 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance || b.priority - a.priority || a.path.localeCompare(b.path),
    )
    .slice(0, limit);
}

export function buildShortlist(
  found: FoundUnit[],
  map: CompiledMap,
  scoringLimit: number,
  coverage: number,
): FoundUnit[] {
  const byPath = new Map<string, FoundUnit>();
  for (const unit of [...found].sort(
    (a, b) => b.retrieval - a.retrieval || b.priority - a.priority || a.path.localeCompare(b.path),
  )) {
    byPath.set(unit.path, unit);
  }

  const units = [...map.nodes.values()].filter((node) => node.kind === "unit");

  const areas = [...map.nodes.values()]
    .filter(
      (node) =>
        node.kind === "area" && (node.path === map.root || isDescendant(node.path, map.root)),
    )
    .sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));

  for (const area of areas) {
    const hottest = units
      .filter((unit) => isDescendant(unit.path, area.path))
      .sort(byPriority)
      .slice(0, coverage);
    for (const unit of hottest) {
      if (byPath.has(unit.path)) continue;
      byPath.set(unit.path, {
        path: unit.path,
        priority: unit.priority,
        confidence: unit.confidence,
        drivers: unit.drivers,
        retrieval: 0,
        trail: [],
      });
    }
  }

  return [...byPath.values()].slice(0, scoringLimit);
}

function isDescendant(path: string, ancestor: string): boolean {
  if (ancestor === "") return path !== "";
  return path.startsWith(`${ancestor}/`);
}

function byPriority(a: CompiledNode, b: CompiledNode): number {
  return b.priority - a.priority || a.path.localeCompare(b.path);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
