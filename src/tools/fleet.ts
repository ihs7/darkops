import type { RunRecord, RunUnit } from "../state/store";
import type { ToolCatalog, ToolContext, ToolDefinition } from "./registry";

const WORK_LIMIT = 10;

export function buildFleetTools(context: ToolContext, catalog: ToolCatalog): ToolDefinition[] {
  return [workList(context, catalog), changeImpact(context, catalog), safeLanes(context, catalog)];
}

function workList(context: ToolContext, catalog: ToolCatalog): ToolDefinition {
  return {
    name: "work_list",
    description:
      "Rank a fleet's attention for an area: the highest-priority units with drivers, confidence, and uncertainty. Deterministic and free of model calls. Use to decide what to work on next.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: "Area to rank, one of the listed areas.",
          enum: catalog.areas.map((entry) => entry.value),
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { area: catalog.areas },
    run: (args) => {
      const units = scopeUnits(context.record, args.area ?? "").slice(0, WORK_LIMIT);
      const label = args.area || "the repository";
      const content =
        units.length > 0
          ? `Work list for ${label}:\n  ${units.map(workLine).join("\n  ")}`
          : `No units found in ${label}.`;
      return { content, data: { area: args.area || ".", units: units.map(workEntry) } };
    },
  };
}

function changeImpact(context: ToolContext, catalog: ToolCatalog): ToolDefinition {
  return {
    name: "change_impact",
    description:
      "Blast-radius set for a proposed change to one unit: structural dependents plus historical change coupling, ranked by priority. Use to see what a change disturbs before it is made.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Unit path, one of the listed units.",
          enum: catalog.units.map((entry) => entry.value),
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { path: catalog.units },
    run: (args) => {
      const path = args.path ?? "";
      const unit = findUnit(context.record, path);
      if (!unit) return { content: `No unit at ${path}.`, data: null };

      const impacted = impactSet(context.record, unit);
      const content =
        impacted.length > 0
          ? [`change impact for ${unit.relPath}`, `  ${impacted.length} affected file(s):`]
              .concat(
                impacted.map(
                  (entry) => `  ${entry.priority.toFixed(1)} ${entry.path} — ${entry.relation}`,
                ),
              )
              .join("\n")
          : `change impact for ${unit.relPath}: no dependents or coupling found.`;
      return { content, data: { path: unit.relPath, impacted } };
    },
  };
}

function safeLanes(context: ToolContext, catalog: ToolCatalog): ToolDefinition {
  return {
    name: "safe_lanes",
    description:
      "Partition an area's top work items into lanes that do not collide: no two units in a lane import, are imported by, or co-change with each other. Deterministic; use to parallelize agents.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: "Area to partition, one of the listed areas.",
          enum: catalog.areas.map((entry) => entry.value),
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    choices: { area: catalog.areas },
    run: (args) => {
      const candidates = scopeUnits(context.record, args.area ?? "").slice(0, WORK_LIMIT);
      const lanes = partition(candidates);
      const label = args.area || "the repository";
      const content =
        lanes.length > 0
          ? `Safe lanes for ${label}:\n  ${lanes
              .map(
                (lane, index) =>
                  `lane ${index + 1}: ${lane.map((unit) => unit.relPath).join(", ")}`,
              )
              .join("\n  ")}`
          : `No units found in ${label}.`;
      return {
        content,
        data: {
          area: args.area || ".",
          lanes: lanes.map((lane) =>
            lane.map((unit) => ({ path: unit.relPath, priority: unit.priority })),
          ),
        },
      };
    },
  };
}

function impactSet(
  record: RunRecord,
  unit: RunUnit,
): Array<{ path: string; priority: number; relation: string }> {
  const byPath = new Map(record.units.map((entry) => [entry.relPath, entry]));
  const impacted = new Map<string, { path: string; priority: number; relation: string }>();

  for (const dependent of unit.graph?.dependents ?? []) {
    impacted.set(dependent, {
      path: dependent,
      priority: byPath.get(dependent)?.priority ?? 0,
      relation: "imports it",
    });
  }
  for (const coupling of unit.history?.couplings ?? []) {
    if (impacted.has(coupling.path)) continue;
    impacted.set(coupling.path, {
      path: coupling.path,
      priority: byPath.get(coupling.path)?.priority ?? 0,
      relation: `co-changes ${Math.round(coupling.strength * 100)}%`,
    });
  }

  return [...impacted.values()].sort(
    (a, b) => b.priority - a.priority || a.path.localeCompare(b.path),
  );
}

function partition(units: RunUnit[]): RunUnit[][] {
  const lanes: RunUnit[][] = [];
  for (const unit of units) {
    const lane = lanes.find((candidate) => candidate.every((other) => !conflict(unit, other)));
    if (lane) lane.push(unit);
    else lanes.push([unit]);
  }
  return lanes;
}

function conflict(a: RunUnit, b: RunUnit): boolean {
  if (a.relPath === b.relPath) return true;
  if ((a.graph?.dependents ?? []).includes(b.relPath)) return true;
  if ((b.graph?.dependents ?? []).includes(a.relPath)) return true;

  const aCoupled = new Set((a.history?.couplings ?? []).map((coupling) => coupling.path));
  const bCoupled = new Set((b.history?.couplings ?? []).map((coupling) => coupling.path));
  if (aCoupled.has(b.relPath) || bCoupled.has(a.relPath)) return true;
  for (const path of aCoupled) if (bCoupled.has(path)) return true;
  return false;
}

function scopeUnits(record: RunRecord, area: string): RunUnit[] {
  const prefix = area && area !== "." ? area : "";
  return record.units
    .filter((unit) => !unit.error)
    .filter(
      (unit) => prefix === "" || unit.relPath === prefix || unit.relPath.startsWith(`${prefix}/`),
    )
    .sort((a, b) => b.priority - a.priority || a.relPath.localeCompare(b.relPath));
}

function workEntry(unit: RunUnit): {
  path: string;
  priority: number;
  confidence: number;
  drivers: string[];
  uncertain: string[];
} {
  return {
    path: unit.relPath,
    priority: unit.priority,
    confidence: unit.confidence,
    drivers: unit.drivers,
    uncertain: unit.uncertain,
  };
}

function workLine(unit: RunUnit): string {
  const drivers = unit.drivers.join(", ") || "no dominant driver";
  const uncertain = unit.uncertain.length > 0 ? ` (uncertain: ${unit.uncertain.join(", ")})` : "";
  return `${unit.priority.toFixed(1)} ${unit.relPath} — ${drivers}${uncertain}`;
}

function findUnit(record: RunRecord, path: string): RunUnit | undefined {
  return record.units.find((unit) => unit.relPath === path);
}
