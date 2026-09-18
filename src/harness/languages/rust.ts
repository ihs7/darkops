import { posix } from "node:path";
import type { ComplexityFacts } from "../complexity";
import { braceComplexity, stripComments } from "./scan";
import type { LanguageSupport, ModuleFacts } from "./types";

const EXTENSIONS = new Set([".rs"]);
const COMMENT = { line: "//", block: true, strings: false, single: false };
const COMPLEXITY_COMMENT = { line: "//", block: true, strings: true, single: false };

export const rustLanguage: LanguageSupport = {
  id: "rust",
  extensions: EXTENSIONS,
  isTest(relPath) {
    if (relPath.startsWith("tests/")) return true;
    return relPath.split("/").some((segment, index) => index > 0 && segment === "tests");
  },
  isDeclaration() {
    return false;
  },
  extractModuleFacts,
  resolveSpecifiers(fromRel, specifier, unitSet) {
    return resolveRust(fromRel, specifier, unitSet);
  },
  analyzeComplexity(source): ComplexityFacts {
    return braceComplexity(source, {
      functionStart: /^\s*(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s/,
      decision: /\b(?:if|match|for|while|loop)\b|&&|\|\||\?/g,
      comment: COMPLEXITY_COMMENT,
    });
  },
};

function extractModuleFacts(source: string): ModuleFacts {
  const code = stripComments(source, COMMENT);
  const runtimeImports = new Set<string>();
  const runtimeExports = new Set<string>();

  for (const match of code.matchAll(/\buse\s+([\s\S]*?);/g)) {
    for (const path of expandUse(match[1] as string)) runtimeImports.add(path);
  }
  for (const match of code.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm)) {
    runtimeImports.add(`mod:${match[1] as string}`);
  }

  for (const line of code.split("\n")) {
    const name =
      /^\s*pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|const|static|type|mod)\s+(\w+)/.exec(
        line,
      )?.[1];
    if (name) runtimeExports.add(name);
  }

  return {
    runtimeImports: [...runtimeImports],
    typeImports: [],
    runtimeExports: [...runtimeExports],
    typeExports: 0,
  };
}

function expandUse(raw: string): string[] {
  const cleaned = raw.replace(/\bas\s+\w+/g, "").replace(/\s+/g, "");
  const brace = cleaned.indexOf("{");
  if (brace === -1) return cleaned.length > 0 ? [cleaned] : [];

  const prefix = cleaned.slice(0, brace);
  const inner = cleaned.slice(brace + 1).replace(/}/g, "");
  return inner
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => `${prefix}${item}`);
}

function resolveRust(fromRel: string, specifier: string, unitSet: ReadonlySet<string>): string[] {
  const moduleDir = moduleDirectory(fromRel);

  if (specifier.startsWith("crate::")) {
    return resolveModule(crateRoot(fromRel), specifier.slice(7), unitSet);
  }
  if (specifier.startsWith("super::")) {
    return resolveModule(posix.dirname(moduleDir), specifier.slice(7), unitSet);
  }
  if (specifier.startsWith("self::")) return resolveModule(moduleDir, specifier.slice(6), unitSet);
  if (specifier.startsWith("mod:")) return resolveModule(moduleDir, specifier.slice(4), unitSet);
  return [];
}

function crateRoot(fromRel: string): string {
  const nested = /^(.*)\/src\//.exec(fromRel);
  if (nested?.[1] !== undefined) return `${nested[1]}/src`;
  if (fromRel.startsWith("src/")) return "src";
  return "";
}

function moduleDirectory(fromRel: string): string {
  const dir = posix.dirname(fromRel);
  const stem = posix.basename(fromRel).replace(/\.rs$/, "");
  if (stem === "mod" || stem === "lib" || stem === "main") return dir;
  return posix.join(dir, stem);
}

function resolveModule(base: string, modulePath: string, unitSet: ReadonlySet<string>): string[] {
  const relative = modulePath.replace(/::/g, "/");
  const path = [base, relative].filter((part) => part && part !== ".").join("/");
  if (path === "") return [];
  for (const candidate of [`${path}.rs`, `${path}/mod.rs`]) {
    if (unitSet.has(candidate)) return [candidate];
  }
  return [];
}
