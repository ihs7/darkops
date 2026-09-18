import { describe, expect, test } from "bun:test";
import type { CompiledNode } from "../src/map/compile";
import { compileMap } from "../src/map/compile";
import { search, STOP, type RankOptions, type ScoreRelevance } from "../src/map/search";
import { buildMap } from "../src/map/tree";
import type { RunRecord, RunUnit } from "../src/state/store";

function unit(relPath: string, priority: number): RunUnit {
  return {
    relPath,
    kind: "source",
    bytes: 1,
    hash: relPath,
    priority,
    confidence: 0.9,
    drivers: ["criticality"],
    uncertain: [],
    signals: null,
    graph: null,
    history: null,
    complexity: null,
    answers: null,
  };
}

function record(units: RunUnit[]): RunRecord {
  return {
    id: "run_test",
    startedAt: "",
    finishedAt: "",
    root: "",
    mode: "git",
    model: "jev-test",
    counts: { total: units.length, scored: units.length, failed: 0, skipped: 0 },
    usage: { calls: 0, cached: 0, failed: 0, inputTokens: 0, outputTokens: 0 },
    skipped: [],
    units,
  };
}

function ranker(prefer: (node: CompiledNode) => boolean, confidence = 0.9): RankOptions {
  return async (_intent, _node, candidates) => {
    const probabilities: Record<string, number> = {};
    for (const candidate of candidates) {
      probabilities[candidate.node.path] = prefer(candidate.node) ? 0.9 : 0.05;
    }
    return { probabilities, choice: STOP, confidence };
  };
}

function scorer(relevant: Record<string, number>): ScoreRelevance {
  return async (_intent, paths) => {
    const judgments = new Map<string, { relevance: number; confidence: number }>();
    for (const path of paths) {
      judgments.set(path, { relevance: relevant[path] ?? 0, confidence: 0.8 });
    }
    return { judgments, usage: { inputTokens: 0, outputTokens: 0 } };
  };
}

const tree = () =>
  buildMap(
    record([
      unit("payments/refunds.ts", 88),
      unit("payments/charge.ts", 40),
      unit("auth/session.ts", 70),
      unit("auth/login.ts", 30),
    ]),
  );

describe("compileMap", () => {
  test("records depth, parent, and children", () => {
    const map = compileMap(tree());
    expect(map.nodes.get("payments")?.depth).toBe(1);
    expect(map.nodes.get("payments")?.parent).toBe("");
    expect(map.nodes.get("payments/refunds.ts")?.parent).toBe("payments");
    expect(map.nodes.get("payments")?.children).toContain("payments/refunds.ts");
  });
});

describe("search", () => {
  test("returns a ranked list of opportunities, not a single path", async () => {
    const result = await search(compileMap(tree()), "anything", {
      rank: ranker(() => false),
      limit: 5,
    });

    expect(result.opportunities.length).toBeGreaterThanOrEqual(2);
    const paths = result.opportunities.map((opportunity) => opportunity.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("can skip levels directly to a deeper file", async () => {
    const result = await search(compileMap(tree()), "refunds", {
      rank: ranker((node) => node.path === "payments/refunds.ts"),
      limit: 5,
    });

    const top = result.opportunities[0];
    expect(top?.path).toBe("payments/refunds.ts");
    expect(top?.trail).toHaveLength(1);
    expect(top?.trail[0]?.from).toBe(".");
  });

  test("ranks the shortlist by judged relevance, not intrinsic priority", async () => {
    const result = await search(compileMap(tree()), "auth work", {
      rank: ranker(() => false),
      score: scorer({ "auth/login.ts": 0.9, "payments/refunds.ts": 0.3 }),
      limit: 5,
    });

    expect(result.opportunities[0]?.path).toBe("auth/login.ts");
    expect(result.opportunities[0]?.relevance).toBe(0.9);
  });

  test("reserves a slot for an area the walk never reached", async () => {
    const map = compileMap(
      buildMap(record([unit("a/a.ts", 10), unit("b/deep/nested/only.ts", 95)])),
    );

    const result = await search(map, "the only file that matters", {
      rank: ranker((node) => node.path === "a" || node.path === "a/a.ts"),
      score: scorer({ "b/deep/nested/only.ts": 0.9, "a/a.ts": 0.1 }),
      budget: 1,
      limit: 5,
    });

    expect(result.opportunities[0]?.path).toBe("b/deep/nested/only.ts");
    expect(result.opportunities[0]?.relevance).toBe(0.9);
  });

  test("stops when the budget is exhausted", async () => {
    const result = await search(compileMap(tree()), "anything", {
      rank: ranker(() => false),
      budget: 1,
    });

    expect(result.steps).toBe(1);
    expect(result.stop).toBe("budget");
  });

  test("skips branches whose confidence is too low", async () => {
    const result = await search(compileMap(tree()), "anything", {
      rank: ranker(() => false, 0.05),
      minConfidence: 0.5,
    });

    expect(result.opportunities).toEqual([]);
  });
});
