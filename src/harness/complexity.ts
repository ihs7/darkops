import { adapterFor } from "./languages";

export interface ComplexityFacts {
  functions: number;
  totalCyclomatic: number;
  maxCyclomatic: number;
  maxNesting: number;
  maxFunctionLines: number;
}

export const EMPTY_COMPLEXITY: ComplexityFacts = {
  functions: 0,
  totalCyclomatic: 0,
  maxCyclomatic: 0,
  maxNesting: 0,
  maxFunctionLines: 0,
};

export function analyzeComplexity(source: string, filename: string): ComplexityFacts {
  const adapter = adapterFor(filename);
  if (!adapter) return { ...EMPTY_COMPLEXITY };
  return adapter.analyzeComplexity(source, filename);
}
