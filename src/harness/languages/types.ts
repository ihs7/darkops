import type { ComplexityFacts } from "../complexity";

export interface ModuleFacts {
  runtimeImports: string[];
  typeImports: string[];
  runtimeExports: string[];
  typeExports: number;
}

export interface ResolveContext {
  goModule?: string;
}

export interface LanguageSupport {
  id: string;
  extensions: ReadonlySet<string>;
  isTest(relPath: string): boolean;
  isDeclaration(relPath: string): boolean;
  extractModuleFacts(source: string, name: string): ModuleFacts;
  resolveSpecifiers(
    fromRel: string,
    specifier: string,
    unitSet: ReadonlySet<string>,
    context: ResolveContext,
  ): string[];
  analyzeComplexity(source: string, name: string): ComplexityFacts;
}
