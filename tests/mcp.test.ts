import { describe, expect, test } from "bun:test";
import { handleMessage, type McpServerInfo } from "../src/mcp/server";
import type { ToolDefinition } from "../src/tools/registry";

const echo: ToolDefinition = {
  name: "describe_unit",
  description: "Fetch details for a unit.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Unit path.", enum: ["a.ts"] } },
    required: ["path"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  choices: { path: [{ value: "a.ts", description: "priority 90" }] },
  run: (args) => ({ content: `details for ${args.path ?? "?"}`, data: { path: args.path } }),
};

const slow: ToolDefinition = {
  name: "investigate",
  description: "Answer an objective.",
  inputSchema: {
    type: "object",
    properties: { intent: { type: "string", description: "Objective." } },
    required: ["intent"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  choices: {},
  run: async (args) => ({ content: `investigated ${args.intent ?? "?"}`, data: null }),
};

const info: McpServerInfo = { name: "darkops", version: "0.0.1", tools: [echo, slow] };

describe("mcp handleMessage", () => {
  test("answers initialize with protocol and capabilities", async () => {
    const response = await handleMessage(info, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const result = response?.result as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string };
    };
    expect(result.protocolVersion).toBeDefined();
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("darkops");
  });

  test("lists tools with their input schema", async () => {
    const response = await handleMessage(info, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (response as { result: { tools: { name: string; inputSchema: unknown }[] } })
      .result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["describe_unit", "investigate"]);
    expect(tools[0]?.inputSchema).toBeDefined();
  });

  test("calls a tool and returns content", async () => {
    const response = await handleMessage(info, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "describe_unit", arguments: { path: "a.ts" } },
    });
    const result = response?.result as { content: { text: string }[] };
    expect(result.content[0]?.text).toBe("details for a.ts");
  });

  test("awaits asynchronous tool results", async () => {
    const response = await handleMessage(info, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "investigate", arguments: { intent: "why refunds" } },
    });
    const result = response?.result as { content: { text: string }[] };
    expect(result.content[0]?.text).toBe("investigated why refunds");
  });

  test("marks an unknown tool as an error result", async () => {
    const response = await handleMessage(info, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "nope" },
    });
    const result = (response as { result: { isError: boolean } }).result;
    expect(result.isError).toBe(true);
  });

  test("rejects unknown methods", async () => {
    const response = await handleMessage(info, { jsonrpc: "2.0", id: 5, method: "resources/list" });
    expect(response?.error?.code).toBe(-32601);
  });

  test("stays silent for notifications", async () => {
    expect(
      await handleMessage(info, { jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
  });
});
