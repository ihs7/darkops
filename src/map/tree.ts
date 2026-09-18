import type { RunRecord, RunUnit } from "../state/store";

export interface MapNode {
  path: string;
  name: string;
  kind: "area" | "unit";
  units: number;
  priority: number;
  confidence: number;
  drivers: string[];
  hot: string | null;
  hint: string;
  error: boolean;
  children: MapNode[];
}

interface DraftArea {
  name: string;
  path: string;
  areas: Map<string, DraftArea>;
  units: RunUnit[];
}

interface Summary {
  units: number;
  priority: number;
  confidence: number;
  drivers: string[];
  hot: string | null;
  error: boolean;
}

export function buildMap(record: RunRecord): MapNode {
  const root: DraftArea = { name: "", path: "", areas: new Map(), units: [] };
  for (const unit of record.units) insert(root, unit);
  return toNode(root);
}

function insert(root: DraftArea, unit: RunUnit): void {
  const segments = unit.relPath.split("/");
  let area = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const name = segments[index] as string;
    let child = area.areas.get(name);
    if (!child) {
      child = {
        name,
        path: area.path ? `${area.path}/${name}` : name,
        areas: new Map(),
        units: [],
      };
      area.areas.set(name, child);
    }
    area = child;
  }

  area.units.push(unit);
}

function toNode(area: DraftArea): MapNode {
  const children = [...[...area.areas.values()].map(toNode), ...area.units.map(toUnitNode)].sort(
    byPriority,
  );

  const summary = summarize(children);
  return {
    path: area.path,
    name: area.path ? (area.name as string) : ".",
    kind: "area",
    ...summary,
    hint: areaHint(area.path, summary),
    children,
  };
}

function toUnitNode(unit: RunUnit): MapNode {
  const error = Boolean(unit.error);
  return {
    path: unit.relPath,
    name: unit.relPath.slice(unit.relPath.lastIndexOf("/") + 1),
    kind: "unit",
    units: 1,
    priority: unit.priority,
    confidence: unit.confidence,
    drivers: unit.drivers,
    hot: unit.relPath,
    hint: unitHint(unit, error),
    error,
    children: [],
  };
}

function summarize(children: MapNode[]): Summary {
  const representative = children.find((child) => !child.error) ?? null;
  return {
    units: children.reduce((sum, child) => sum + child.units, 0),
    priority: representative?.priority ?? 0,
    confidence: representative?.confidence ?? 0,
    drivers: representative?.drivers ?? [],
    hot: representative?.hot ?? null,
    error: representative === null,
  };
}

function unitHint(unit: RunUnit, error: boolean): string {
  if (error) return `unscored: ${unit.error ?? "unknown error"}`;
  const drivers = unit.drivers.length > 0 ? unit.drivers.join(", ") : "no dominant driver";
  const uncertain = unit.uncertain.length > 0 ? ` · uncertain: ${unit.uncertain.join(", ")}` : "";
  return `${drivers}${uncertain}`;
}

function areaHint(path: string, summary: Summary): string {
  if (summary.units === 0) return "no source units";
  if (summary.error) return "no scored units";
  const where = summary.hot ? relativeTo(path, summary.hot) : "unknown";
  const drivers = summary.drivers.length > 0 ? summary.drivers.join(", ") : "no dominant driver";
  return `hottest ${where} (${summary.priority.toFixed(1)}) via ${drivers}`;
}

function relativeTo(areaPath: string, target: string): string {
  return areaPath && target.startsWith(`${areaPath}/`) ? target.slice(areaPath.length + 1) : target;
}

function byPriority(a: MapNode, b: MapNode): number {
  return b.priority - a.priority || a.path.localeCompare(b.path);
}

export function findNode(node: MapNode, path: string): MapNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

export function selectScope(root: MapNode, path?: string): MapNode[] {
  if (!path) return root.children;
  const node = findNode(root, path);
  if (!node) return [];
  return node.kind === "unit" ? [node] : node.children;
}
