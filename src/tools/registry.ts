import type { MapNode } from "../map/tree";
import type { RunRecord, RunUnit } from "../state/store";
import { buildFleetTools } from "./fleet";

export interface ToolContext {
  record: RunRecord;
  tree: MapNode;
}

export interface CatalogEntry {
  value: string;
  description: string;
}

export interface ToolCatalog {
  units: CatalogEntry[];
  areas: CatalogEntry[];
}

export interface ToolProperty {
  type: "string";
  description: string;
  enum?: string[];
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolProperty>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolResult {
  content: string;
  data: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: { readOnlyHint: true };
  choices: Record<string, CatalogEntry[]>;
  run: (args: Record<string, string>) => ToolResult | Promise<ToolResult>;
}

export const MAX_CANDIDATES = 40;
export const MAX_HOTSPOTS = 10;

export function buildCatalog(record: RunRecord, tree: MapNode, scope?: string): ToolCatalog {
  const prefix = scope && scope !== "." ? scope : "";
  const inScope = (path: string) =>
    prefix === "" || path === prefix || path.startsWith(`${prefix}/`);

  const units = record.units
    .filter((unit) => !unit.error && inScope(unit.relPath))
    .sort(byPriority)
    .slice(0, MAX_CANDIDATES)
    .map((unit) => ({ value: unit.relPath, description: unitSummary(unit) }));

  const areas = collectAreas(tree)
    .filter((node) => inScope(node.path))
    .slice(0, MAX_CANDIDATES)
    .map((node) => ({
      value: node.path,
      description: `area, ${node.units} units, priority ${node.priority.toFixed(1)}`,
    }));

  return { units, areas };
}

export function buildTools(context: ToolContext, catalog: ToolCatalog): ToolDefinition[] {
  const unitPaths = catalog.units.map((entry) => entry.value);
  const areaPaths = catalog.areas.map((entry) => entry.value);

  const unitTools = [
    {
      name: "describe_unit",
      description:
        "Fetch the full evidence bundle for one source unit: priority, confidence, drivers, dependency fan-in and fan-out, change history, and complexity. Use when details about a specific file are needed.",
      run: describeUnit,
    },
    {
      name: "list_dependents",
      description:
        "List the files that import a given unit. Use to judge blast radius and who breaks when it changes.",
      run: listDependents,
    },
    {
      name: "list_coupling",
      description:
        "List files that historically change together with a given unit even without an import relationship. Use to find hidden coupling.",
      run: listCoupling,
    },
    {
      name: "git_history",
      description:
        "Summarize the change history of a unit: recent commits, bug fixes, reverts, authorship concentration, and last modified.",
      run: gitHistory,
    },
  ];

  const tools: ToolDefinition[] = unitTools.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Unit path, one of the listed units.",
          enum: unitPaths,
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { path: catalog.units },
    run: (args) => {
      const path = args.path ?? "";
      return spec.run(context.record, path);
    },
  }));

  tools.push({
    name: "list_hotspots",
    description:
      "Rank the highest-priority units inside an area. Use to find where attention should go in a directory or across the repository.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: "Area path, one of the listed areas.",
          enum: areaPaths,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { area: catalog.areas },
    run: (args) => listHotspots(context.record, args.area ?? ""),
  });

  return [...tools, ...buildFleetTools(context, catalog)];
}

function describeUnit(record: RunRecord, path: string): ToolResult {
  const unit = findUnit(record, path);
  if (!unit) return { content: `No unit at ${path}.`, data: null };

  const lines = [
    unit.relPath,
    `  priority    ${unit.priority.toFixed(1)}`,
    `  confidence  ${unit.confidence.toFixed(2)}`,
    `  drivers     ${unit.drivers.join(", ") || "none"}`,
    `  uncertain   ${unit.uncertain.join(", ") || "none"}`,
  ];

  if (unit.signals) {
    lines.push(
      `  signals     criticality ${fixed(unit.signals.criticality)} · blast ${fixed(unit.signals.blastRadius)} · ` +
        `risk ${fixed(unit.signals.changeRisk)} · cohesion ${fixed(unit.signals.cohesion)} · ` +
        `churn ${fixed(unit.signals.churn)} · defect ${fixed(unit.signals.defect)} · ` +
        `complexity ${fixed(unit.signals.complexity)}`,
    );
  }
  if (unit.graph) {
    lines.push(`  graph       fan_in ${unit.graph.fanIn} · fan_out ${unit.graph.fanOut}`);
    if (unit.graph.dependents.length > 0) {
      lines.push(`  dependents  ${unit.graph.dependents.join(", ")}`);
    }
  }
  if (unit.history) {
    lines.push(
      `  history     ${unit.history.recentCommits} recent commits · ` +
        `${unit.history.bugFixCommits} bug fixes · ${unit.history.authors} authors`,
    );
    if (unit.history.couplings.length > 0) {
      lines.push(`  coupled     ${formatCouplings(unit)}`);
    }
  }
  if (unit.complexity) {
    lines.push(
      `  complex     max cyclomatic ${unit.complexity.maxCyclomatic} · ` +
        `nesting ${unit.complexity.maxNesting} · ` +
        `longest method ${unit.complexity.maxFunctionLines} lines`,
    );
  }

  return {
    content: lines.join("\n"),
    data: {
      path: unit.relPath,
      priority: unit.priority,
      confidence: unit.confidence,
      drivers: unit.drivers,
      uncertain: unit.uncertain,
      signals: unit.signals,
      graph: unit.graph,
      history: unit.history,
      complexity: unit.complexity,
    },
  };
}

function listDependents(record: RunRecord, path: string): ToolResult {
  const unit = findUnit(record, path);
  if (!unit) return { content: `No unit at ${path}.`, data: null };

  const dependents = unit.graph?.dependents ?? [];
  const content =
    dependents.length > 0
      ? `${path} is imported by ${dependents.length} file(s):\n  ${dependents.join("\n  ")}`
      : `${path} has no dependents in this run.`;

  return { content, data: { path, dependents } };
}

function listCoupling(record: RunRecord, path: string): ToolResult {
  const unit = findUnit(record, path);
  if (!unit) return { content: `No unit at ${path}.`, data: null };

  const couplings = unit.history?.couplings ?? [];
  const content =
    couplings.length > 0
      ? `${path} changes together with:\n  ${formatCouplings(unit, "\n  ")}`
      : `${path} has no strong change coupling in this run.`;

  return { content, data: { path, couplings } };
}

function gitHistory(record: RunRecord, path: string): ToolResult {
  const unit = findUnit(record, path);
  if (!unit) return { content: `No unit at ${path}.`, data: null };
  const history = unit.history;
  if (!history) return { content: `No history for ${path}.`, data: null };

  const content = [
    `${path} history`,
    `  commits         ${history.commits} (${history.recentCommits} recent)`,
    `  bug fixes       ${history.bugFixCommits}`,
    `  reverts         ${history.revertCommits}`,
    `  authors         ${history.authors} (${history.recentAuthors} recent)`,
    `  top author      ${Math.round(history.primaryAuthorShare * 100)}% of recent commits`,
    `  last modified   ${history.lastModified ?? "unknown"}`,
  ].join("\n");

  return { content, data: { path, ...history } };
}

function listHotspots(record: RunRecord, area: string): ToolResult {
  const prefix = area && area !== "." ? area : "";
  const units = record.units
    .filter((unit) => !unit.error)
    .filter(
      (unit) => prefix === "" || unit.relPath === prefix || unit.relPath.startsWith(`${prefix}/`),
    )
    .sort(byPriority)
    .slice(0, MAX_HOTSPOTS);

  const label = prefix || "the repository";
  const content =
    units.length > 0
      ? `Top units in ${label}:\n  ${units.map(hotspotLine).join("\n  ")}`
      : `No units found in ${label}.`;

  return {
    content,
    data: {
      area: prefix || ".",
      units: units.map((unit) => ({
        path: unit.relPath,
        priority: unit.priority,
        drivers: unit.drivers,
      })),
    },
  };
}

function hotspotLine(unit: RunUnit): string {
  const drivers = unit.drivers.join(", ") || "no dominant driver";
  return `${unit.priority.toFixed(1)} ${unit.relPath} — ${drivers}`;
}

function formatCouplings(unit: RunUnit, separator = ", "): string {
  return (unit.history?.couplings ?? [])
    .map((coupling) => `${coupling.path} (${Math.round(coupling.strength * 100)}%)`)
    .join(separator);
}

function findUnit(record: RunRecord, path: string): RunUnit | undefined {
  return record.units.find((unit) => unit.relPath === path);
}

function collectAreas(tree: MapNode): MapNode[] {
  const areas: MapNode[] = [];
  for (const child of tree.children) {
    if (child.kind !== "area") continue;
    areas.push(child, ...collectAreas(child));
  }
  return areas.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));
}

function unitSummary(unit: RunUnit): string {
  const drivers = unit.drivers.join(", ") || "no dominant driver";
  return `priority ${unit.priority.toFixed(1)}, ${drivers}`;
}

function byPriority(a: RunUnit, b: RunUnit): number {
  return b.priority - a.priority || a.relPath.localeCompare(b.relPath);
}

function fixed(value: number): string {
  return value.toFixed(1);
}
