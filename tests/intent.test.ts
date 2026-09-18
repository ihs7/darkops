import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultResults, runIntent } from "../src/map/intent";
import { createInvestigateTool, createNavigateTool } from "../src/tools/intent";
import type { ToolResult } from "../src/tools/registry";

const ok = (content: string): ToolResult => ({ content, data: null });

const roots: string[] = [];

afterAll(async () => {
  delete process.env.DARKOPS_STATE_DIR;
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("runIntent", () => {
  test("reports a missing run before any model call", async () => {
    const root = await mkdtemp(join(tmpdir(), "darkops-intent-"));
    roots.push(root);
    process.env.DARKOPS_STATE_DIR = join(root, "state");

    await expect(runIntent({ root, intent: "anything" })).rejects.toThrow("No scan run");
  });
});

describe("defaultResults", () => {
  test("floors at 5 for small repositories", () => {
    expect(defaultResults(0)).toBe(5);
    expect(defaultResults(32)).toBe(5);
    expect(defaultResults(100)).toBe(5);
  });

  test("scales with repository size", () => {
    expect(defaultResults(200)).toBe(10);
    expect(defaultResults(400)).toBe(20);
  });

  test("caps at 50 for very large repositories", () => {
    expect(defaultResults(1000)).toBe(50);
    expect(defaultResults(10000)).toBe(50);
  });
});

describe("createNavigateTool", () => {
  test("forwards intent and path to the harness", async () => {
    const calls: [string, string | undefined][] = [];
    const tool = createNavigateTool(
      async (intent, path) => {
        calls.push([intent, path]);
        return ok("nav");
      },
      [{ value: "src", description: "area" }],
    );

    const result = await tool.run({ intent: "harden auth", path: "src" });
    expect(result.content).toBe("nav");
    expect(calls).toEqual([["harden auth", "src"]]);
    expect(tool.inputSchema.required).toEqual(["intent"]);
    expect(tool.inputSchema.properties.path?.enum).toEqual(["src"]);
    expect(tool.inputSchema.properties.run).toBeDefined();
    expect(tool.choices).toEqual({ path: [{ value: "src", description: "area" }] });
  });

  test("forwards an explicit run id", async () => {
    const runs: (string | undefined)[] = [];
    const tool = createNavigateTool(async (_intent, _path, runId) => {
      runs.push(runId);
      return ok("nav");
    }, []);

    await tool.run({ intent: "x", run: "run_7" });
    expect(runs).toEqual(["run_7"]);
  });
});

describe("createInvestigateTool", () => {
  test("forwards the intent", async () => {
    const tool = createInvestigateTool(async (intent) => ok(`got ${intent}`));
    expect((await tool.run({ intent: "why refunds" })).content).toBe("got why refunds");
    expect(tool.choices).toEqual({});
  });
});
