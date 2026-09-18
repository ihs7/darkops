import type { CompiledMap, CompiledNode } from "./compile";

export type StrategyId = "descend" | "symbols" | "imports" | "dependents" | "coupled";

export interface Candidate {
  node: CompiledNode;
  strategy: StrategyId;
  relation: string;
  weight: number;
}

export interface ExpandOptions {
  target: number;
  lookahead: number;
  maxDescend: number;
  maxRelated: number;
  maxSymbols: number;
  intent?: string;
}

export const STRATEGY_IDS: StrategyId[] = [
  "descend",
  "symbols",
  "imports",
  "dependents",
  "coupled",
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "where",
  "what",
  "how",
  "does",
  "this",
  "that",
  "into",
  "from",
  "are",
  "its",
  "use",
  "used",
  "using",
  "about",
  "which",
  "when",
]);

export function expand(
  map: CompiledMap,
  node: CompiledNode,
  visited: ReadonlySet<string>,
  options: ExpandOptions,
): Candidate[] {
  const seen = new Set<string>([node.path]);
  const selected: Candidate[] = [];

  for (const strategy of STRATEGY_IDS) {
    const limit = limitFor(strategy, options);
    if (limit <= 0) continue;
    let count = 0;
    for (const candidate of collect(map, node, strategy, options)) {
      if (count >= limit) break;
      if (seen.has(candidate.node.path) || visited.has(candidate.node.path)) continue;
      seen.add(candidate.node.path);
      selected.push(candidate);
      count += 1;
    }
  }

  return selected.sort(byCandidate);
}

function limitFor(strategy: StrategyId, options: ExpandOptions): number {
  if (strategy === "descend") return options.maxDescend;
  if (strategy === "symbols") return options.maxSymbols;
  return options.maxRelated;
}

function collect(
  map: CompiledMap,
  node: CompiledNode,
  strategy: StrategyId,
  options: ExpandOptions,
): Candidate[] {
  if (strategy === "descend") return descend(map, node, options);
  if (strategy === "symbols") return node.path === map.root ? symbols(map, options) : [];
  return relations(map, node, strategy);
}

function descend(map: CompiledMap, node: CompiledNode, options: ExpandOptions): Candidate[] {
  const candidates: Candidate[] = [];
  const children = node.children
    .map((path) => map.nodes.get(path))
    .filter((child): child is CompiledNode => child !== undefined)
    .sort(byPriority);

  for (const child of children) {
    candidates.push({
      node: child,
      strategy: "descend",
      relation: child.kind === "unit" ? "file in this area" : "sub-area",
      weight: child.priority,
    });
  }

  if (candidates.length < options.target) {
    for (const descendant of descendantsWithin(map, node, options.lookahead)) {
      candidates.push({
        node: descendant,
        strategy: "descend",
        relation: `${descendant.depth - node.depth} levels down`,
        weight: descendant.priority,
      });
    }
  }

  return candidates;
}

function symbols(map: CompiledMap, options: ExpandOptions): Candidate[] {
  const terms = tokenize(options.intent ?? "");
  if (terms.length === 0) return [];

  const scored: { node: CompiledNode; score: number }[] = [];
  for (const node of map.nodes.values()) {
    if (node.kind !== "unit") continue;
    const score = symbolScore(node, terms);
    if (score > 0) scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path));
  return scored.map((entry) => ({
    node: entry.node,
    strategy: "symbols",
    relation: `matches "${matchLabel(entry.node, terms)}"`,
    weight: entry.score,
  }));
}

function relations(map: CompiledMap, node: CompiledNode, strategy: StrategyId): Candidate[] {
  const anchor = anchorUnit(map, node);
  if (!anchor) return [];
  const related = map.relations.get(anchor.path);
  if (!related) return [];
  const label = relativeTo(node.path, anchor.path);

  if (strategy === "imports") {
    return candidates(
      map,
      related.imports.map((path) => ({
        path,
        strategy,
        relation: `imported by ${label}`,
        strength: null,
      })),
    );
  }

  if (strategy === "dependents") {
    return candidates(
      map,
      related.dependents.map((path) => ({
        path,
        strategy,
        relation: `imports ${label}`,
        strength: null,
      })),
    );
  }

  return candidates(
    map,
    related.coupled.map((coupling) => ({
      path: coupling.path,
      strategy,
      relation: `changes together with ${label} (${Math.round(coupling.strength * 100)}%)`,
      strength: coupling.strength,
    })),
  );
}

interface Draft {
  path: string;
  strategy: StrategyId;
  relation: string;
  strength: number | null;
}

function candidates(map: CompiledMap, drafts: Draft[]): Candidate[] {
  const list: Candidate[] = [];
  for (const draft of drafts) {
    const node = map.nodes.get(draft.path);
    if (!node) continue;
    list.push({
      node,
      strategy: draft.strategy,
      relation: draft.relation,
      weight: draft.strength ?? node.priority,
    });
  }
  return list;
}

function symbolScore(node: CompiledNode, terms: string[]): number {
  const target = symbolTerms(node);
  let score = 0;
  for (const term of terms) {
    if (matches(term, target)) score += 1;
  }
  return score;
}

function matchLabel(node: CompiledNode, terms: string[]): string {
  let best = node.name;
  let bestScore = 0;
  for (const symbol of node.exports) {
    const tokens = new Set(splitIdentifier(symbol));
    let score = 0;
    for (const term of terms) {
      if (matches(term, tokens)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = symbol;
    }
  }
  return best;
}

function symbolTerms(node: CompiledNode): Set<string> {
  const terms = new Set<string>(pathTerms(node.path));
  for (const symbol of node.exports) {
    for (const token of splitIdentifier(symbol)) terms.add(token);
  }
  return terms;
}

function tokenize(text: string): string[] {
  const terms = new Set<string>();
  for (const token of splitIdentifier(text)) {
    if (!STOPWORDS.has(token)) terms.add(token);
  }
  return [...terms];
}

function pathTerms(path: string): string[] {
  return splitIdentifier(path);
}

function splitIdentifier(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function matches(term: string, target: Set<string>): boolean {
  for (const token of target) {
    if (token === term) return true;
    if (term.length >= 4 && token.startsWith(term)) return true;
    if (token.length >= 4 && term.startsWith(token)) return true;
  }
  return false;
}

function anchorUnit(map: CompiledMap, node: CompiledNode): CompiledNode | null {
  if (node.kind === "unit") return node;
  if (!node.hot) return null;
  return map.nodes.get(node.hot) ?? null;
}

function descendantsWithin(
  map: CompiledMap,
  node: CompiledNode,
  lookahead: number,
): CompiledNode[] {
  const reach = node.depth + lookahead;
  const found: CompiledNode[] = [];
  for (const candidate of map.nodes.values()) {
    if (candidate.depth > reach) continue;
    if (candidate.path === node.path) continue;
    if (!isDescendant(candidate.path, node.path)) continue;
    found.push(candidate);
  }
  return found.sort(byPriority);
}

function isDescendant(path: string, ancestor: string): boolean {
  if (ancestor === "") return path !== "";
  return path.startsWith(`${ancestor}/`);
}

function relativeTo(area: string, path: string): string {
  if (area === "") return path;
  return path.startsWith(`${area}/`) ? path.slice(area.length + 1) : path;
}

function byPriority(a: CompiledNode, b: CompiledNode): number {
  return b.priority - a.priority || a.path.localeCompare(b.path);
}

function byCandidate(a: Candidate, b: Candidate): number {
  return b.weight - a.weight || a.node.path.localeCompare(b.node.path);
}
