import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComplexityFacts } from "../complexity";
import { braceComplexity, stripComments } from "./scan";
import type { LanguageSupport, ModuleFacts, ResolveContext } from "./types";

const EXTENSIONS = new Set([".go"]);
const COMMENT = { line: "//", block: true, strings: false };
const COMPLEXITY_COMMENT = { line: "//", block: true, strings: true };

export const goLanguage: LanguageSupport = {
  id: "go",
  extensions: EXTENSIONS,
  isTest(relPath) {
    return relPath.endsWith("_test.go");
  },
  isDeclaration() {
    return false;
  },
  extractModuleFacts,
  resolveSpecifiers(fromRel, specifier, unitSet, context) {
    const directory = localDirectory(specifier, unitSet, context);
    if (directory === null) return [];
    return goFiles(directory, unitSet);
  },
  analyzeComplexity(source): ComplexityFacts {
    return braceComplexity(source, {
      functionStart: /^\s*func\s/,
      decision: /\b(?:if|for|case|select)\b|&&|\|\|/g,
      comment: COMPLEXITY_COMMENT,
    });
  },
};

export async function readGoModule(root: string): Promise<string | undefined> {
  const raw = await readFile(join(root, "go.mod"), "utf8").catch(() => null);
  if (!raw) return undefined;
  return /^module\s+(\S+)/m.exec(raw)?.[1];
}

function extractModuleFacts(source: string): ModuleFacts {
  const code = stripComments(source, COMMENT);
  const runtimeImports = new Set<string>();
  const runtimeExports = new Set<string>();

  const importBlock = /import\s*(?:\(([\s\S]*?)\)|("(?:[^"\\]|\\.)*"))/g;
  for (const match of code.matchAll(importBlock)) {
    const body = match[1] ?? match[2] ?? "";
    for (const quoted of body.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      runtimeImports.add(quoted[0].slice(1, -1));
    }
  }

  for (const line of code.split("\n")) {
    const name =
      /^func\s+([A-Z]\w*)/.exec(line)?.[1] ??
      /^func\s*\([^)]*\)\s+([A-Z]\w*)/.exec(line)?.[1] ??
      /^type\s+([A-Z]\w*)/.exec(line)?.[1] ??
      /^(?:var|const)\s+([A-Z]\w*)/.exec(line)?.[1];
    if (name) runtimeExports.add(name);
  }

  return {
    runtimeImports: [...runtimeImports],
    typeImports: [],
    runtimeExports: [...runtimeExports],
    typeExports: 0,
  };
}

function localDirectory(
  specifier: string,
  unitSet: ReadonlySet<string>,
  context: ResolveContext,
): string | null {
  if (context.goModule) {
    if (specifier === context.goModule) return "";
    if (specifier.startsWith(`${context.goModule}/`)) {
      return specifier.slice(context.goModule.length + 1);
    }
    return null;
  }

  let best: string | null = null;
  for (const path of unitSet) {
    if (!path.endsWith(".go") || path.endsWith("_test.go")) continue;
    const slash = path.lastIndexOf("/");
    if (slash <= 0) continue;
    const directory = path.slice(0, slash);
    if (specifier !== directory && !specifier.endsWith(`/${directory}`)) continue;
    if (best === null || directory.length > best.length) best = directory;
  }
  return best;
}

function goFiles(directory: string, unitSet: ReadonlySet<string>): string[] {
  const prefix = directory === "" ? "" : `${directory}/`;
  const files: string[] = [];
  for (const path of unitSet) {
    if (!path.endsWith(".go") || path.endsWith("_test.go")) continue;
    if (directory === "") {
      if (!path.includes("/")) files.push(path);
    } else if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
      files.push(path);
    }
  }
  return files.sort();
}
