import { createInterface } from "node:readline";
import type { ToolDefinition } from "../tools/registry";

export const PROTOCOL_VERSION = "2025-06-18";

export interface McpServerInfo {
  name: string;
  version: string;
  tools: ToolDefinition[];
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleMessage(
  info: McpServerInfo,
  message: JsonRpcMessage,
): Promise<JsonRpcMessage | null> {
  if (message.id === undefined || message.id === null) return null;

  switch (message.method) {
    case "initialize":
      return ok(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: info.name, version: info.version },
      });
    case "ping":
      return ok(message.id, {});
    case "tools/list":
      return ok(message.id, { tools: info.tools.map(toMcpTool) });
    case "tools/call":
      return ok(message.id, await callTool(info, message.params));
    default:
      return fail(message.id, -32601, `Method not found: ${message.method ?? "unknown"}`);
  }
}

export async function serveStdio(info: McpServerInfo): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(text) as JsonRpcMessage;
    } catch {
      continue;
    }

    const response = await handleMessage(info, message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

function toMcpTool(tool: ToolDefinition): unknown {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

async function callTool(info: McpServerInfo, params: unknown): Promise<unknown> {
  const { name, arguments: args } = (params ?? {}) as {
    name?: string;
    arguments?: Record<string, string>;
  };

  const tool = info.tools.find((entry) => entry.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name ?? "undefined"}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.run(args ?? {});
    return { content: [{ type: "text", text: result.content }], structuredContent: result.data };
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

function ok(id: string | number, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number, code: number, message: string): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
