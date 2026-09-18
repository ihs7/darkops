import { posix } from "node:path";
import type { ComplexityFacts } from "../complexity";
import { indentComplexity, stripComments } from "./scan";
import type { LanguageSupport, ModuleFacts } from "./types";

const EXTENSIONS = new Set([".py"]);
const TEST_DIRS = new Set(["test", "tests", "__tests__"]);
const COMMENT = { line: "#", block: false, strings: false, triple: true };
const COMPLEXITY_COMMENT = { line: "#", block: false, strings: true, triple: true };

export const pythonLanguage: LanguageSupport = {
  id: "python",
  extensions: EXTENSIONS,
  isTest(relPath) {
    const name = relPath.slice(relPath.lastIndexOf("/") + 1);
    if (name.startsWith("test_") || name.endsWith("_test.py")) return true;
    return relPath.split("/").some((segment) => TEST_DIRS.has(segment));
  },
  isDeclaration(relPath) {
    return relPath.endsWith(".pyi");
  },
  extractModuleFacts,
  resolveSpecifiers(fromRel, specifier, unitSet) {
    return resolvePython(fromRel, specifier, unitSet);
  },
  analyzeComplexity(source): ComplexityFacts {
    return indentComplexity(source, {
      functionStart: /^\s*(?:async\s+)?def\s+\w+/,
      decision: /\b(?:if|elif|for|while|except)\b|\band\b|\bor\b/g,
      block: /^\s*(?:if|elif|else|for|while|try|except|finally|with|match|case)\b/,
      comment: COMPLEXITY_COMMENT,
    });
  },
};

function extractModuleFacts(source: string): ModuleFacts {
  const code = stripComments(source, COMMENT);
  const runtimeImports = new Set<string>();
  const runtimeExports = new Set<string>();

  for (const line of code.split("\n")) {
    const trimmed = line.trim();

    const direct = /^import\s+(.+)$/.exec(trimmed);
    if (direct?.[1]) {
      for (const item of splitNames(direct[1])) runtimeImports.add(item);
    }

    const from = /^from\s+([\w.]*)\s+import\s+(.+)$/.exec(trimmed);
    if (from?.[1] !== undefined && from[2] !== undefined) {
      const module = from[1];
      if (module.replace(/\./g, "") === "") {
        for (const item of splitNames(from[2])) runtimeImports.add(`${module}${item}`);
      } else {
        runtimeImports.add(module);
      }
    }

    if (line.length === line.trimStart().length) {
      const defined = /^(?:async\s+)?def\s+(\w+)/.exec(line) ?? /^class\s+(\w+)/.exec(line);
      const name = defined?.[1];
      if (name && !name.startsWith("_")) runtimeExports.add(name);
    }
  }

  return {
    runtimeImports: [...runtimeImports],
    typeImports: [],
    runtimeExports: [...runtimeExports],
    typeExports: 0,
  };
}

function splitNames(raw: string): string[] {
  const cleaned = raw.replace(/[()]/g, "");
  return cleaned
    .split(",")
    .map(
      (item) =>
        item
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim() ?? "",
    )
    .filter((item) => item.length > 0);
}

function resolvePython(fromRel: string, specifier: string, unitSet: ReadonlySet<string>): string[] {
  const dots = (/^\.+/.exec(specifier)?.[0] ?? "").length;
  const rest = specifier.slice(dots);
  const parts = rest.split(".").filter(Boolean);

  let base = dots > 0 ? posix.dirname(fromRel) : "";
  for (let level = 1; level < dots; level += 1) base = posix.dirname(base);

  const modulePath = [base, ...parts].filter((part) => part && part !== ".").join("/");
  if (modulePath === "") return [];

  for (const candidate of [`${modulePath}.py`, `${modulePath}/__init__.py`]) {
    if (unitSet.has(candidate)) return [candidate];
  }
  return [];
}
