import { describe, expect, test } from "bun:test";
import { buildDispatchPlan, NO_TOOL, readToolCall } from "../src/jev/dispatcher";
import type { ToolDefinition } from "../src/tools/registry";

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "describe_unit",
    description: "Fetch details for a unit.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Unit path.", enum: ["a.ts", "b.ts"] },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: {
      path: [
        { value: "a.ts", description: "priority 90" },
        { value: "b.ts", description: "priority 10" },
      ],
    },
    run: () => ({ content: "", data: null }),
    ...overrides,
  };
}

const optional = tool({
  name: "list_hotspots",
  description: "Rank units in an area.",
  inputSchema: {
    type: "object",
    properties: { area: { type: "string", description: "Area.", enum: ["pkg"] } },
    additionalProperties: false,
  },
  choices: { area: [{ value: "pkg", description: "area" }] },
});

describe("buildDispatchPlan", () => {
  test("asks one tool question and per-argument questions", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    expect(plan.questions.__tool__).toBeDefined();
    expect(plan.questions["describe_unit.path"]).toBeDefined();
    expect(plan.questions["list_hotspots.area"]).toBeDefined();
  });

  test("asks a stated question only for optional arguments", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    expect(plan.questions["describe_unit.path?"]).toBeUndefined();
    expect(plan.questions["list_hotspots.area?"]).toBeDefined();
  });
});

describe("readToolCall", () => {
  test("maps the chosen tool and required argument", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    const call = readToolCall(plan, {
      __tool__: { choice: "describe_unit", confidence: 0.9 },
      "describe_unit.path": { choice: "a.ts", confidence: 0.8 },
    });
    expect(call).toEqual({ name: "describe_unit", arguments: { path: "a.ts" }, confidence: 0.8 });
  });

  test("omits an optional argument when the intent does not state it", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    const call = readToolCall(plan, {
      __tool__: { choice: "list_hotspots", confidence: 1 },
      "list_hotspots.area?": { noul: 0.1 },
      "list_hotspots.area": { choice: "pkg", confidence: 0.9 },
    });
    expect(call?.arguments).toEqual({});
  });

  test("includes an optional argument when stated", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    const call = readToolCall(plan, {
      __tool__: { choice: "list_hotspots", confidence: 1 },
      "list_hotspots.area?": { noul: 0.9 },
      "list_hotspots.area": { choice: "pkg", confidence: 0.9 },
    });
    expect(call?.arguments).toEqual({ area: "pkg" });
  });

  test("returns null when no tool fits", () => {
    const plan = buildDispatchPlan([tool(), optional]);
    expect(readToolCall(plan, { __tool__: { choice: NO_TOOL, confidence: 1 } })).toBeNull();
  });

  test("rejects a value outside the closed set", () => {
    const plan = buildDispatchPlan([tool()]);
    const call = readToolCall(plan, {
      __tool__: { choice: "describe_unit", confidence: 0.9 },
      "describe_unit.path": { choice: "evil.ts", confidence: 0.9 },
    });
    expect(call?.arguments).toEqual({});
  });

  test("reports the least certain judgment as confidence", () => {
    const plan = buildDispatchPlan([tool()]);
    const call = readToolCall(plan, {
      __tool__: { choice: "describe_unit", confidence: 0.95 },
      "describe_unit.path": { choice: "a.ts", confidence: 0.4 },
    });
    expect(call?.confidence).toBe(0.4);
  });
});
