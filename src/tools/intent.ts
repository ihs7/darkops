import type { CatalogEntry, ToolDefinition, ToolResult } from "./registry";

export interface NavigateHandler {
  (intent: string, path: string | undefined, runId?: string): Promise<ToolResult>;
}

export interface InvestigateHandler {
  (intent: string): Promise<ToolResult>;
}

export function createNavigateTool(run: NavigateHandler, areas: CatalogEntry[]): ToolDefinition {
  return {
    name: "navigate",
    description:
      "Find where to look for an objective by descending the repository map with Jev. Returns a target path and a reasoning trail.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Objective guiding the descent." },
        path: {
          type: "string",
          description: "Area to start from.",
          enum: areas.map((e) => e.value),
        },
        run: { type: "string", description: "Run id to search; defaults to the server's run." },
      },
      required: ["intent"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { path: areas },
    run: (args) => run(args.intent ?? "", args.path, args.run),
  };
}

export function createInvestigateTool(investigate: InvestigateHandler): ToolDefinition {
  return {
    name: "investigate",
    description:
      "Answer an objective about the repository by selecting and running the most useful darkops tool. Use when the right evidence or area is unclear.",
    inputSchema: {
      type: "object",
      properties: { intent: { type: "string", description: "Question or objective." } },
      required: ["intent"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: {},
    run: (args) => investigate(args.intent ?? ""),
  };
}
