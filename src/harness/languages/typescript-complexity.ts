import { parse } from "@babel/parser";
import type { ComplexityFacts } from "../complexity";

interface FunctionContext {
  cyclomatic: number;
  depth: number;
  maxDepth: number;
  node: Record<string, unknown> | null;
}

interface Tally {
  functions: number;
  total: number;
  maxCyclomatic: number;
  maxNesting: number;
  maxFunctionLines: number;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const DECISION_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
  "LogicalExpression",
]);

const NESTING_TYPES = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "TryStatement",
]);

const SKIP_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "errors",
]);

export function analyzeTypeScriptComplexity(source: string, filename: string): ComplexityFacts {
  const program = parseProgram(source, filename);
  if (!program) {
    return {
      functions: 0,
      totalCyclomatic: 0,
      maxCyclomatic: 0,
      maxNesting: 0,
      maxFunctionLines: 0,
    };
  }

  const contexts: FunctionContext[] = [rootContext()];
  const tally: Tally = {
    functions: 0,
    total: 0,
    maxCyclomatic: 0,
    maxNesting: 0,
    maxFunctionLines: 0,
  };

  visit(program, contexts, tally);

  const root = contexts[0] as FunctionContext;
  tally.total += root.cyclomatic;
  tally.maxCyclomatic = Math.max(tally.maxCyclomatic, root.cyclomatic);

  return {
    functions: tally.functions,
    totalCyclomatic: tally.total,
    maxCyclomatic: tally.maxCyclomatic,
    maxNesting: tally.maxNesting,
    maxFunctionLines: tally.maxFunctionLines,
  };
}

function parseProgram(source: string, filename: string): Record<string, unknown> | null {
  try {
    const ast = parse(source, {
      sourceType: "module",
      sourceFilename: filename,
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
    return ast.program as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

function visit(value: unknown, contexts: FunctionContext[], tally: Tally): void {
  if (Array.isArray(value)) {
    for (const child of value) visit(child, contexts, tally);
    return;
  }
  if (!value || typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  const type = node.type;
  if (typeof type !== "string") return;

  const isFunction = FUNCTION_TYPES.has(type);
  if (isFunction) {
    tally.functions += 1;
    contexts.push(functionContext(node));
  } else if (countsAsDecision(type, node)) {
    current(contexts).cyclomatic += 1;
  }

  const nests = NESTING_TYPES.has(type);
  if (nests) enterNesting(current(contexts));

  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    visit(node[key], contexts, tally);
  }

  if (nests) current(contexts).depth -= 1;
  if (isFunction) closeFunction(contexts, tally);
}

function countsAsDecision(type: string, node: Record<string, unknown>): boolean {
  if (type === "SwitchCase") return Boolean(node.test);
  return DECISION_TYPES.has(type);
}

function enterNesting(context: FunctionContext): void {
  context.depth += 1;
  if (context.depth > context.maxDepth) context.maxDepth = context.depth;
}

function closeFunction(contexts: FunctionContext[], tally: Tally): void {
  const context = contexts.pop() as FunctionContext;
  tally.total += context.cyclomatic;
  tally.maxCyclomatic = Math.max(tally.maxCyclomatic, context.cyclomatic);
  tally.maxNesting = Math.max(tally.maxNesting, context.maxDepth);
  tally.maxFunctionLines = Math.max(tally.maxFunctionLines, functionLines(context.node));
}

function functionLines(node: Record<string, unknown> | null): number {
  const loc = node?.loc as { start?: { line?: number }; end?: { line?: number } } | undefined;
  const start = loc?.start?.line;
  const end = loc?.end?.line;
  return typeof start === "number" && typeof end === "number" ? end - start + 1 : 0;
}

function rootContext(): FunctionContext {
  return { cyclomatic: 1, depth: 0, maxDepth: 0, node: null };
}

function functionContext(node: Record<string, unknown>): FunctionContext {
  return { cyclomatic: 1, depth: 0, maxDepth: 0, node };
}

function current(contexts: FunctionContext[]): FunctionContext {
  return contexts[contexts.length - 1] as FunctionContext;
}
