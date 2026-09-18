import { goLanguage } from "./go";
import { pythonLanguage } from "./python";
import { rustLanguage } from "./rust";
import { typescriptLanguage } from "./typescript";
import type { LanguageSupport } from "./types";

const LANGUAGES: readonly LanguageSupport[] = [
  typescriptLanguage,
  pythonLanguage,
  goLanguage,
  rustLanguage,
];

export function adapterFor(relPath: string): LanguageSupport | undefined {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return undefined;
  const extension = relPath.slice(dot).toLowerCase();
  return LANGUAGES.find((language) => language.extensions.has(extension));
}

export function isSourcePath(relPath: string): boolean {
  const adapter = adapterFor(relPath);
  if (!adapter) return false;
  return !adapter.isDeclaration(relPath);
}

export function isTestPath(relPath: string): boolean {
  return adapterFor(relPath)?.isTest(relPath) ?? false;
}

export function knownExtensions(): string[] {
  return [...new Set(LANGUAGES.flatMap((language) => [...language.extensions]))].sort();
}

export { goLanguage, pythonLanguage, rustLanguage, typescriptLanguage };
export type { LanguageSupport, ModuleFacts, ResolveContext } from "./types";
