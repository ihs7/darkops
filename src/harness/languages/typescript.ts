import { parse as parseModules } from "es-module-lexer";
import { posix } from "node:path";
import type { ComplexityFacts } from "../complexity";
import { stripComments } from "./scan";
import { analyzeTypeScriptComplexity } from "./typescript-complexity";
import type { LanguageSupport, ModuleFacts } from "./types";

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "e2e"]);

const MODULE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.mts",
  "/index.cts",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
];

const JS_TO_TS: Record<string, string> = {
  ".js": ".ts",
  ".jsx": ".tsx",
  ".mjs": ".mts",
  ".cjs": ".cts",
};

export const typescriptLanguage: LanguageSupport = {
  id: "typescript",
  extensions: EXTENSIONS,
  isTest(relPath) {
    if (TEST_FILE.test(relPath)) return true;
    return relPath.split("/").some((segment) => TEST_DIRS.has(segment));
  },
  isDeclaration(relPath) {
    return DECLARATION.test(relPath);
  },
  extractModuleFacts,
  resolveSpecifiers(fromRel, specifier, unitSet) {
    if (!specifier.startsWith(".")) return [];
    const base = posix.normalize(posix.join(posix.dirname(fromRel), specifier));
    const candidates = new Set<string>();
    for (const suffix of MODULE_SUFFIXES) candidates.add(base + suffix);

    const extension = posix.extname(base);
    const mapped = JS_TO_TS[extension];
    if (mapped) {
      const stem = base.slice(0, base.length - extension.length);
      for (const suffix of MODULE_SUFFIXES) candidates.add(stem + mapped + suffix);
    }

    for (const candidate of candidates) {
      if (unitSet.has(candidate)) return [candidate];
    }
    return [];
  },
  analyzeComplexity(source, name): ComplexityFacts {
    return analyzeTypeScriptComplexity(source, name);
  },
};

function extractModuleFacts(source: string, name: string): ModuleFacts {
  const runtimeImports = new Set<string>();
  const typeImports = new Set<string>();
  const runtimeExports = new Set<string>();
  let typeExports = 0;

  let parsed: ReturnType<typeof parseModules> | null = null;
  try {
    parsed = parseModules(source, name);
  } catch {
    parsed = null;
  }

  if (parsed) {
    const [imports, exports] = parsed;
    for (const record of imports) {
      if (record.type !== "static" && record.type !== "reexport-star") continue;
      if (!record.specifier) continue;
      (record.typeOnly ? typeImports : runtimeImports).add(record.specifier);
    }

    for (const record of exports) {
      if (record.type === "reexport-all") {
        if (record.typeOnly) typeExports += 1;
        continue;
      }
      if (record.typeOnly) {
        typeExports += 1;
        continue;
      }
      runtimeExports.add(record.name);
    }
  }

  const commonjs = stripComments(source, { line: "//", block: true, strings: false });
  for (const match of commonjs.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    runtimeImports.add(match[1] as string);
  }
  for (const match of commonjs.matchAll(/\bexports\.(\w+)\s*=/g)) {
    runtimeExports.add(match[1] as string);
  }
  for (const match of commonjs.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] as string).split(",")) {
      const name = part.trim().split(":")[0]?.trim() ?? "";
      if (/^\w+$/.test(name)) runtimeExports.add(name);
    }
  }

  return {
    runtimeImports: [...runtimeImports],
    typeImports: [...typeImports],
    runtimeExports: [...runtimeExports],
    typeExports,
  };
}
