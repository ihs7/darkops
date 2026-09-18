import { describe, expect, test } from "bun:test";
import { buildMap, findNode, selectScope } from "../src/map/tree";
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

describe("buildMap", () => {
  test("aggregates an area to its hottest unit", () => {
    const root = buildMap(record([unit("src/a.ts", 10), unit("src/b.ts", 80)]));
    const area = findNode(root, "src");

    expect(area?.kind).toBe("area");
    expect(area?.priority).toBe(80);
    expect(area?.units).toBe(2);
    expect(area?.hot).toBe("src/b.ts");
    expect(area?.hint).toContain("b.ts");
  });

  test("surfaces a hot leaf inside an otherwise quiet area", () => {
    const root = buildMap(
      record([
        unit("src/core/a.ts", 5),
        unit("src/core/b.ts", 5),
        unit("src/core/c.ts", 5),
        unit("src/core/hot.ts", 90),
      ]),
    );
    const area = findNode(root, "src/core");

    expect(area?.priority).toBe(90);
    expect(area?.hot).toBe("src/core/hot.ts");
  });

  test("nests areas by directory", () => {
    const root = buildMap(record([unit("src/payments/refunds.ts", 50)]));

    expect(findNode(root, "src/payments")?.kind).toBe("area");
    expect(findNode(root, "src/payments/refunds.ts")?.kind).toBe("unit");
  });

  test("keeps root-level files at the top level", () => {
    const nodes = selectScope(buildMap(record([unit("cli.ts", 30), unit("src/a.ts", 10)])));

    expect(nodes.map((node) => node.path)).toContain("cli.ts");
    expect(nodes.map((node) => node.path)).toContain("src");
  });

  test("marks unscored units instead of hiding them", () => {
    const failed: RunUnit = { ...unit("src/broken.ts", 0), error: "boom" };
    const node = findNode(buildMap(record([failed])), "src/broken.ts");

    expect(node?.error).toBe(true);
    expect(node?.hint).toContain("boom");
  });
});

describe("selectScope", () => {
  test("opens an area to its children", () => {
    const root = buildMap(record([unit("src/payments/a.ts", 40), unit("src/payments/b.ts", 20)]));
    const children = selectScope(root, "src/payments");

    expect(children.map((node) => node.path)).toEqual(["src/payments/a.ts", "src/payments/b.ts"]);
  });

  test("returns a unit when scoped to a file", () => {
    const root = buildMap(record([unit("src/a.ts", 10)]));

    expect(selectScope(root, "src/a.ts").map((node) => node.kind)).toEqual(["unit"]);
  });

  test("yields no nodes for an unknown path", () => {
    const root = buildMap(record([unit("src/a.ts", 10)]));

    expect(selectScope(root, "does/not/exist")).toEqual([]);
  });
});
