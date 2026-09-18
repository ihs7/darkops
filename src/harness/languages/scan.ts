import type { ComplexityFacts } from "../complexity";

export interface CommentStyle {
  line: string;
  block: boolean;
  strings: boolean;
  single?: boolean;
  triple?: boolean;
}

export function stripComments(source: string, style: CommentStyle): string {
  const single = style.single !== false;
  const triple = style.triple === true;
  let out = "";
  let i = 0;
  let inBlock = false;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];

    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        const take = Math.min(2, source.length - i);
        out += style.strings ? " ".repeat(take) : source.slice(i, i + take);
        i += take;
        continue;
      }
      if (source.startsWith(quote, i)) {
        out += style.strings ? " ".repeat(quote.length) : quote;
        i += quote.length;
        quote = null;
        continue;
      }
      out += style.strings ? (ch === "\n" ? "\n" : " ") : ch;
      i += 1;
      continue;
    }

    const isQuote = ch === '"' || ch === "`" || (ch === "'" && single);
    if (isQuote) {
      if (triple && (ch === '"' || ch === "'") && source.startsWith(ch.repeat(3), i)) {
        quote = ch.repeat(3);
        out += quote;
        i += 3;
        continue;
      }
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (style.block && ch === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }

    if (style.line && source.startsWith(style.line, i)) {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export interface BraceSpec {
  functionStart: RegExp;
  decision: RegExp;
  comment: CommentStyle;
}

interface BraceFrame {
  fn: boolean;
  startLine: number;
  cyclomatic: number;
  depth: number;
}

export function braceComplexity(source: string, spec: BraceSpec): ComplexityFacts {
  const lines = stripComments(source, spec.comment).split("\n");
  const stack: BraceFrame[] = [{ fn: false, startLine: -1, cyclomatic: 1, depth: 0 }];
  let functions = 0;
  let total = 0;
  let maxCyclomatic = 0;
  let maxNesting = 0;
  let maxFunctionLines = 0;
  let pendingFunction = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (spec.functionStart.test(line)) {
      functions += 1;
      pendingFunction = true;
    }

    const decisions = line.match(spec.decision);
    if (decisions) {
      let target = stack[0] as BraceFrame;
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        const frame = stack[depth] as BraceFrame;
        if (frame.fn) {
          target = frame;
          break;
        }
      }
      target.cyclomatic += decisions.length;
    }

    for (const ch of line) {
      if (ch === "{") {
        const parent = stack[stack.length - 1] as BraceFrame;
        stack.push({
          fn: pendingFunction,
          startLine: index,
          cyclomatic: 1,
          depth: parent.depth + 1,
        });
        pendingFunction = false;
      } else if (ch === "}") {
        if (stack.length <= 1) continue;
        const closed = stack.pop() as BraceFrame;
        if (closed.fn) {
          total += closed.cyclomatic;
          maxCyclomatic = Math.max(maxCyclomatic, closed.cyclomatic);
          maxNesting = Math.max(maxNesting, closed.depth);
          maxFunctionLines = Math.max(maxFunctionLines, index - closed.startLine + 1);
        }
      }
    }
  }

  const root = stack[0] as BraceFrame;
  total += root.cyclomatic;
  maxCyclomatic = Math.max(maxCyclomatic, root.cyclomatic);

  return {
    functions,
    totalCyclomatic: total,
    maxCyclomatic,
    maxNesting,
    maxFunctionLines,
  };
}

export interface IndentSpec {
  functionStart: RegExp;
  decision: RegExp;
  block: RegExp;
  comment: CommentStyle;
}

interface IndentFunction {
  indent: number;
  startLine: number;
  cyclomatic: number;
  maxDepth: number;
}

export function indentComplexity(source: string, spec: IndentSpec): ComplexityFacts {
  const lines = stripComments(source, spec.comment).split("\n");
  const functions: IndentFunction[] = [];
  const blocks: number[] = [];
  let functionsCount = 0;
  let total = 0;
  let maxCyclomatic = 0;
  let maxNesting = 0;
  let maxFunctionLines = 0;
  let rootCyclomatic = 1;
  let lastContent = 0;

  const finalize = (fn: IndentFunction, endLine: number): void => {
    total += fn.cyclomatic;
    maxCyclomatic = Math.max(maxCyclomatic, fn.cyclomatic);
    maxNesting = Math.max(maxNesting, fn.maxDepth);
    maxFunctionLines = Math.max(maxFunctionLines, endLine - fn.startLine + 1);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    if (raw.trim().length === 0) continue;
    lastContent = index;

    const indent = raw.length - raw.trimStart().length;

    while (
      functions.length > 0 &&
      indent <= (functions[functions.length - 1] as IndentFunction).indent
    ) {
      finalize(functions.pop() as IndentFunction, lastContentBefore(index, lines));
    }
    while (blocks.length > 0 && indent <= (blocks[blocks.length - 1] as number)) blocks.pop();

    if (spec.functionStart.test(raw)) {
      functions.push({ indent, startLine: index, cyclomatic: 1, maxDepth: 0 });
      functionsCount += 1;
      continue;
    }

    const decisions = raw.match(spec.decision);
    if (decisions) {
      const current = functions[functions.length - 1];
      if (current) current.cyclomatic += decisions.length;
      else rootCyclomatic += decisions.length;
    }

    if (spec.block.test(raw)) {
      blocks.push(indent);
      const current = functions[functions.length - 1];
      if (current) current.maxDepth = Math.max(current.maxDepth, blocks.length);
    }
  }

  for (const fn of functions) finalize(fn, lastContent);
  total += rootCyclomatic;
  maxCyclomatic = Math.max(maxCyclomatic, rootCyclomatic);

  return {
    functions: functionsCount,
    totalCyclomatic: total,
    maxCyclomatic,
    maxNesting,
    maxFunctionLines,
  };
}

function lastContentBefore(index: number, lines: string[]): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if ((lines[i] as string).trim().length > 0) return i;
  }
  return index;
}
