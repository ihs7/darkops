import { adapterFor, typescriptLanguage } from "./languages";
import type { ModuleFacts, ResolveContext } from "./languages";
import { readGoModule } from "./languages/go";
import type { SourceUnit } from "./discover";

export type { ModuleFacts } from "./languages";

export interface UnitGraph {
  fanIn: number;
  fanOut: number;
  imports: string[];
  dependents: string[];
  typeImports: number;
  exports: string[];
  typeExports: number;
}

export interface GraphResult {
  graph: Map<string, UnitGraph>;
}

export interface GraphOptions {
  root?: string;
}

export function extractModuleFacts(source: string, name: string): ModuleFacts {
  const adapter = adapterFor(name) ?? typescriptLanguage;
  return adapter.extractModuleFacts(source, name);
}

export function resolveSpecifier(
  fromRel: string,
  specifier: string,
  unitSet: ReadonlySet<string>,
): string | null {
  const adapter = adapterFor(fromRel) ?? typescriptLanguage;
  return adapter.resolveSpecifiers(fromRel, specifier, unitSet, {})[0] ?? null;
}

export async function buildGraph(
  units: readonly SourceUnit[],
  options: GraphOptions = {},
): Promise<GraphResult> {
  const context: ResolveContext = {};
  if (options.root) context.goModule = await readGoModule(options.root);

  const unitSet = new Set(units.map((unit) => unit.relPath));
  const dependents = new Map<string, Set<string>>();
  for (const unit of units) dependents.set(unit.relPath, new Set());

  const graph = new Map<string, UnitGraph>();

  for (const unit of units) {
    const adapter = adapterFor(unit.relPath) ?? typescriptLanguage;
    const facts = adapter.extractModuleFacts(unit.content, unit.relPath);
    const resolved = new Set<string>();

    for (const specifier of facts.runtimeImports) {
      for (const target of adapter.resolveSpecifiers(unit.relPath, specifier, unitSet, context)) {
        if (target !== unit.relPath) resolved.add(target);
      }
    }

    for (const target of resolved) dependents.get(target)?.add(unit.relPath);

    graph.set(unit.relPath, {
      fanIn: 0,
      fanOut: resolved.size,
      imports: [...resolved].sort(),
      dependents: [],
      typeImports: facts.typeImports.length,
      exports: [...facts.runtimeExports].sort(),
      typeExports: facts.typeExports,
    });
  }

  for (const [relPath, importers] of dependents) {
    const entry = graph.get(relPath);
    if (!entry) continue;
    entry.fanIn = importers.size;
    entry.dependents = [...importers].sort();
  }

  return { graph };
}
