import type { RunRecord } from "../state/store";
import type { MapNode } from "./tree";

export interface NodeRelations {
  imports: string[];
  dependents: string[];
  coupled: { path: string; strength: number }[];
  exports: string[];
}

export interface CompiledNode {
  path: string;
  name: string;
  kind: "area" | "unit";
  depth: number;
  parent: string | null;
  priority: number;
  confidence: number;
  drivers: string[];
  units: number;
  hot: string | null;
  hint: string;
  exports: string[];
  children: string[];
}

export interface CompiledMap {
  root: string;
  nodes: Map<string, CompiledNode>;
  relations: Map<string, NodeRelations>;
}

export function compileMap(tree: MapNode, record?: RunRecord): CompiledMap {
  const relations = collectRelations(record);
  const nodes = new Map<string, CompiledNode>();

  const walk = (node: MapNode, depth: number, parent: string | null): void => {
    nodes.set(node.path, {
      path: node.path,
      name: node.name,
      kind: node.kind,
      depth,
      parent,
      priority: node.priority,
      confidence: node.confidence,
      drivers: node.drivers,
      units: node.units,
      hot: node.hot,
      hint: node.hint,
      exports: relations.get(node.path)?.exports ?? [],
      children: node.children.map((child) => child.path),
    });
    for (const child of node.children) walk(child, depth + 1, node.path);
  };

  walk(tree, 0, null);
  return { root: tree.path, nodes, relations };
}

function collectRelations(record?: RunRecord): Map<string, NodeRelations> {
  const relations = new Map<string, NodeRelations>();
  if (!record) return relations;

  for (const unit of record.units) {
    relations.set(unit.relPath, {
      imports: unit.graph?.imports ?? [],
      dependents: unit.graph?.dependents ?? [],
      coupled: (unit.history?.couplings ?? []).map((coupling) => ({
        path: coupling.path,
        strength: coupling.strength,
      })),
      exports: unit.graph?.exports ?? [],
    });
  }

  return relations;
}
