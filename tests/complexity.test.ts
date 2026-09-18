import { describe, expect, test } from "bun:test";
import { analyzeComplexity } from "../src/harness/complexity";

describe("analyzeComplexity", () => {
  test("module with no functions has root complexity only", () => {
    const facts = analyzeComplexity("export const a = 1;\n", "a.ts");
    expect(facts.functions).toBe(0);
    expect(facts.maxCyclomatic).toBe(1);
  });

  test("counts decision points and nesting per function", () => {
    const source = [
      "export function pick(x: number): number {",
      "  if (x > 0) return 1;",
      "  if (x < 0) return -1;",
      "  return 0;",
      "}",
      "",
    ].join("\n");

    const facts = analyzeComplexity(source, "a.ts");
    expect(facts.functions).toBe(1);
    expect(facts.maxCyclomatic).toBe(3);
    expect(facts.maxNesting).toBe(1);
    expect(facts.maxFunctionLines).toBe(5);
  });

  test("nested loops raise max nesting", () => {
    const source = [
      "export function f(xs: number[]) {",
      "  for (const x of xs) {",
      "    while (x > 0) {",
      "      x--;",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");

    const facts = analyzeComplexity(source, "a.ts");
    expect(facts.maxNesting).toBe(2);
    expect(facts.maxCyclomatic).toBe(3);
  });

  test("returns zeroed facts when parsing fails", () => {
    const facts = analyzeComplexity("function ( {", "broken.ts");
    expect(facts.functions).toBe(0);
    expect(facts.maxCyclomatic).toBe(0);
  });
});
