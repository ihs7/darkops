import { describe, expect, test } from "bun:test";
import type { ComplexityFacts } from "../src/harness/complexity";
import type { UnitGraph } from "../src/harness/graph";
import type { FileHistory } from "../src/harness/history";
import type { UnitSignals } from "../src/jev/policy";
import { buildMap } from "../src/map/tree";
import type { RunRecord, RunUnit } from "../src/state/store";
import { buildCatalog, buildTools, type ToolResult } from "../src/tools/registry";

const signals: UnitSignals = {
  criticality: 2,
  blastRadius: 3,
  cohesion: 1,
  changeRisk: 2,
  churn: 1.5,
  defect: 1,
  complexity: 2.5,
  confidence: 0.9,
};

function unit(relPath: string, priority: number, overrides: Partial<RunUnit> = {}): RunUnit {
  return {
    relPath,
    kind: "source",
    bytes: 1,
    hash: relPath,
    priority,
    confidence: 0.9,
    drivers: ["churn", "complexity"],
    uncertain: [],
    signals,
    graph: null,
    history: null,
    complexity: null,
    answers: null,
    ...overrides,
  };
}

const graph = (dependents: string[]): UnitGraph => ({
  fanIn: dependents.length,
  fanOut: 0,
  imports: [],
  dependents,
  typeImports: 0,
  exports: [],
  typeExports: 0,
});

const history: FileHistory = {
  commits: 10,
  recentCommits: 4,
  authors: 3,
  recentAuthors: 2,
  primaryAuthorShare: 0.5,
  bugFixCommits: 2,
  revertCommits: 0,
  lastModified: "2026-01-01T00:00:00Z",
  firstSeen: "2025-01-01T00:00:00Z",
  sumCoupling: 1,
  couplings: [{ path: "src/payments/charge.ts", coChanges: 5, strength: 0.7 }],
};

const complexity: ComplexityFacts = {
  functions: 5,
  totalCyclomatic: 20,
  maxCyclomatic: 9,
  maxNesting: 4,
  maxFunctionLines: 80,
};

function fixture(): RunRecord {
  const units = [
    unit("src/payments/refunds.ts", 88, {
      graph: graph(["src/api/route.ts"]),
      history,
      complexity,
    }),
    unit("src/payments/charge.ts", 40),
    unit("src/auth/session.ts", 70, { graph: graph(["src/auth/login.ts", "src/api/route.ts"]) }),
  ];
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

function tools() {
  const record = fixture();
  const tree = buildMap(record);
  const catalog = buildCatalog(record, tree);
  return { record, tree, catalog, tools: buildTools({ record, tree }, catalog) };
}

async function run(name: string, args: Record<string, string>): Promise<ToolResult> {
  const tool = tools().tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.run(args);
}

describe("tool registry", () => {
  test("exposes the read-only evidence tools", () => {
    const names = tools().tools.map((tool) => tool.name);
    expect(names).toEqual([
      "describe_unit",
      "list_dependents",
      "list_coupling",
      "git_history",
      "list_hotspots",
      "work_list",
      "change_impact",
      "safe_lanes",
    ]);
    expect(tools().tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  test("offers every candidate unit as a closed set", () => {
    const catalog = tools().catalog;
    expect(catalog.units.map((entry) => entry.value)).toEqual([
      "src/payments/refunds.ts",
      "src/auth/session.ts",
      "src/payments/charge.ts",
    ]);
    const describe = tools().tools[0];
    expect(describe?.inputSchema.properties.path?.enum).toEqual(
      catalog.units.map((entry) => entry.value),
    );
  });

  test("describes one unit with its evidence", async () => {
    const result = await run("describe_unit", { path: "src/payments/refunds.ts" });
    expect(result.content).toContain("src/payments/refunds.ts");
    expect(result.content).toContain("fan_in 1");
    expect(result.content).toContain("2 bug fixes");
    expect((result.data as { priority: number }).priority).toBe(88);
  });

  test("lists dependents and coupling", async () => {
    expect((await run("list_dependents", { path: "src/payments/refunds.ts" })).content).toContain(
      "src/api/route.ts",
    );
    expect((await run("list_coupling", { path: "src/payments/refunds.ts" })).content).toContain(
      "src/payments/charge.ts (70%)",
    );
  });

  test("summarizes git history", async () => {
    const result = await run("git_history", { path: "src/payments/refunds.ts" });
    expect(result.content).toContain("commits         10 (4 recent)");
  });

  test("ranks hotspots within an area", async () => {
    const result = await run("list_hotspots", { area: "src/payments" });
    expect(result.content.indexOf("refunds.ts")).toBeLessThan(result.content.indexOf("charge.ts"));
    expect((result.data as { units: unknown[] }).units).toHaveLength(2);
  });

  test("reports an unknown unit instead of guessing", async () => {
    expect((await run("describe_unit", { path: "nope.ts" })).content).toBe("No unit at nope.ts.");
  });

  test("ranks a work list within an area", async () => {
    const result = await run("work_list", { area: "src/payments" });
    expect(result.content.indexOf("refunds.ts")).toBeLessThan(result.content.indexOf("charge.ts"));
    expect((result.data as { units: unknown[] }).units).toHaveLength(2);
  });

  test("fuses dependents and coupling into a change impact set", async () => {
    const result = await run("change_impact", { path: "src/payments/refunds.ts" });
    const impacted = (result.data as { impacted: { path: string; relation: string }[] }).impacted;
    expect(impacted.map((entry) => entry.path)).toEqual([
      "src/payments/charge.ts",
      "src/api/route.ts",
    ]);
    expect(result.content).toContain("co-changes 70%");
  });

  test("separates colliding work into distinct lanes", async () => {
    const result = await run("safe_lanes", { area: "src/payments" });
    const lanes = (result.data as { lanes: { path: string }[][] }).lanes;
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.map((entry) => entry.path))).toEqual([
      ["src/payments/refunds.ts"],
      ["src/payments/charge.ts"],
    ]);
  });
});
