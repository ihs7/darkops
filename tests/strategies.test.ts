import { describe, expect, test } from "bun:test";
import { describeCandidate, present } from "../src/jev/navigator";
import type { CompiledNode } from "../src/map/compile";
import { compileMap } from "../src/map/compile";
import { search, STOP, type RankOptions } from "../src/map/search";
import { expand, type Candidate } from "../src/map/strategies";
import { buildMap } from "../src/map/tree";
import type { RunRecord, RunUnit } from "../src/state/store";
import type { UnitGraph } from "../src/harness/graph";

function unit(relPath: string, priority: number, overrides: Partial<RunUnit> = {}): RunUnit {
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
    ...overrides,
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

function graph(imports: string[], dependents: string[], exports: string[] = []): UnitGraph {
  return {
    fanIn: dependents.length,
    fanOut: imports.length,
    imports,
    dependents,
    typeImports: 0,
    exports,
    typeExports: 0,
  };
}

function deepFixture(): RunRecord {
  return record([
    unit("src/app.ts", 40, { graph: graph(["lib/deep/nested/cache.ts"], []) }),
    unit("src/other.ts", 5),
    unit("lib/deep/nested/cache.ts", 10, { graph: graph([], ["src/app.ts"]) }),
  ]);
}

function rootOf(rec: RunRecord): CompiledNode {
  const map = compileMap(buildMap(rec), rec);
  const root = map.nodes.get("");
  if (!root) throw new Error("no root");
  return root;
}

describe("expand", () => {
  test("surfaces a deep import the tree walk cannot reach", () => {
    const rec = deepFixture();
    const map = compileMap(buildMap(rec), rec);
    const root = rootOf(rec);
    const candidates = expand(map, root, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
    });

    const cache = candidates.find((entry) => entry.node.path === "lib/deep/nested/cache.ts");
    expect(cache?.strategy).toBe("imports");
    expect(cache?.relation).toContain("imported by src/app.ts");
  });

  test("lists a path once when two strategies offer it", () => {
    const rec = record([
      unit("src/app.ts", 40, { graph: graph(["src/other.ts"], []) }),
      unit("src/other.ts", 5),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const root = rootOf(rec);
    const candidates: Candidate[] = expand(map, root, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
    });

    const matches = candidates.filter((entry) => entry.node.path === "src/other.ts");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.strategy).toBe("descend");
  });

  test("offers dependents and change coupling with their relation", () => {
    const rec = record([
      unit("src/app.ts", 40, { graph: graph([], ["src/consumer.ts"]) }),
      unit("src/consumer.ts", 5),
      unit("lib/hidden.ts", 20, {
        history: {
          commits: 0,
          recentCommits: 0,
          authors: 0,
          recentAuthors: 0,
          primaryAuthorShare: 0,
          bugFixCommits: 0,
          revertCommits: 0,
          lastModified: null,
          firstSeen: null,
          sumCoupling: 0,
          couplings: [{ path: "lib/coupled.ts", coChanges: 3, strength: 0.8 }],
        },
      }),
      unit("lib/coupled.ts", 15),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const app = map.nodes.get("src/app.ts");
    if (!app) throw new Error("no src/app.ts");
    const candidates = expand(map, app, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
    });

    expect(candidates.find((entry) => entry.node.path === "src/consumer.ts")?.strategy).toBe(
      "dependents",
    );

    const hidden = map.nodes.get("lib/hidden.ts");
    if (!hidden) throw new Error("no lib/hidden.ts");
    const coupled = expand(map, hidden, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
    });
    expect(coupled.find((entry) => entry.node.path === "lib/coupled.ts")?.strategy).toBe("coupled");
  });
});

describe("symbols strategy", () => {
  test("surfaces a deep file whose exported symbol matches the intent", () => {
    const rec = record([
      unit("src/app.ts", 40),
      unit("lib/deep/nested/cache.ts", 10, { graph: graph([], [], ["invalidateCache"]) }),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const root = rootOf(rec);
    const candidates = expand(map, root, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
      intent: "where is the cache invalidated",
    });

    const match = candidates.find((entry) => entry.node.path === "lib/deep/nested/cache.ts");
    expect(match?.strategy).toBe("symbols");
    expect(match?.relation).toContain("invalidateCache");
  });

  test("names the strongest matching symbol, not the first alphabetically", () => {
    const rec = record([
      unit("src/app.ts", 40),
      unit("lib/deep/nested/cache.ts", 10, { graph: graph([], [], ["cachePath", "loadCache"]) }),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const root = rootOf(rec);
    const candidates = expand(map, root, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
      intent: "where is the cache loaded",
    });

    const match = candidates.find((entry) => entry.node.path === "lib/deep/nested/cache.ts");
    expect(match?.relation).toContain("loadCache");
  });

  test("does not run without an intent", () => {
    const rec = record([
      unit("src/app.ts", 40),
      unit("lib/deep/nested/cache.ts", 10, { graph: graph([], [], ["invalidateCache"]) }),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const root = rootOf(rec);
    const candidates = expand(map, root, new Set(), {
      target: 12,
      lookahead: 2,
      maxDescend: 40,
      maxRelated: 6,
      maxSymbols: 5,
    });

    expect(candidates.some((entry) => entry.strategy === "symbols")).toBe(false);
  });
});

describe("candidate descriptions", () => {
  test("surface exported symbols so the query can match them", () => {
    const rec = record([
      unit("src/cache.ts", 20, { graph: graph([], [], ["invalidateCache", "readCache"]) }),
    ]);
    const map = compileMap(buildMap(rec), rec);
    const node = map.nodes.get("src/cache.ts");
    if (!node) throw new Error("no src/cache.ts");

    expect(node.exports).toContain("invalidateCache");
    const text = describeCandidate(
      { node, strategy: "descend", relation: "file in this area", weight: node.priority },
      0,
    );
    expect(text).toContain("src/cache.ts");
    expect(text).toContain("invalidateCache");
    expect(text).toContain("readCache");
    expect(text).not.toContain("priority");
  });

  test("presents candidates in a risk-neutral order", () => {
    const hot = {
      node: { path: "b.ts" } as CompiledNode,
      strategy: "descend" as const,
      relation: "",
      weight: 100,
    };
    const cold = {
      node: { path: "a.ts" } as CompiledNode,
      strategy: "descend" as const,
      relation: "",
      weight: 1,
    };
    expect(present([hot, cold]).map((candidate) => candidate.node.path)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("search with graph expansion", () => {
  test("reaches a related file and records the strategy in the trail", async () => {
    const rec = deepFixture();
    const map = compileMap(buildMap(rec), rec);
    const target = "lib/deep/nested/cache.ts";

    const rank: RankOptions = async (_intent, _node, candidates) => {
      const probabilities: Record<string, number> = {};
      for (const candidate of candidates) {
        probabilities[candidate.node.path] = candidate.node.path === target ? 0.9 : 0.05;
      }
      return { probabilities, choice: STOP, confidence: 0.9 };
    };

    const result = await search(map, "where is the persistence layer", { rank, limit: 5 });
    const top = result.opportunities.find((opportunity) => opportunity.path === target);

    expect(top).toBeDefined();
    expect(top?.trail[0]?.strategy).toBe("imports");
    expect(top?.trail[0]?.relation).toContain("imported by src/app.ts");
  });
});
