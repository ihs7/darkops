import { describe, expect, test } from "bun:test";
import type { SourceUnit } from "../src/harness/discover";
import { buildGraph, extractModuleFacts, resolveSpecifier } from "../src/harness/graph";

function unit(relPath: string, content: string): SourceUnit {
  return {
    path: `/repo/${relPath}`,
    relPath,
    kind: relPath.includes(".test.") ? "test" : "source",
    content,
    hash: relPath,
    bytes: content.length,
    lines: content.split("\n").length,
  };
}

describe("module graph", () => {
  test("extracts runtime imports, type-only imports, and exports", () => {
    const facts = extractModuleFacts(
      "import { b } from './b';\nimport type { T } from './t';\nexport const a = b;\n",
      "a.ts",
    );
    expect(facts.runtimeImports).toEqual(["./b"]);
    expect(facts.typeImports).toEqual(["./t"]);
    expect(facts.runtimeExports).toContain("a");
    expect(facts.typeExports).toBe(0);
  });

  test("resolves .js specifiers to .ts and directory imports to index", () => {
    const set = new Set(["src/b.ts", "src/pkg/index.ts"]);
    expect(resolveSpecifier("src/a.ts", "./b.js", set)).toBe("src/b.ts");
    expect(resolveSpecifier("src/a.ts", "./pkg", set)).toBe("src/pkg/index.ts");
    expect(resolveSpecifier("src/a.ts", "react", set)).toBeNull();
  });

  test("builds fan-in, fan-out, and dependents", async () => {
    const units = [
      unit("src/a.ts", "import { b } from './b';\nexport const a = b;\n"),
      unit("src/b.ts", "export const b = 1;\n"),
      unit("src/c.ts", "import { b } from './b.js';\nexport const c = b;\n"),
    ];

    const { graph } = await buildGraph(units);
    expect(graph.get("src/a.ts")?.fanOut).toBe(1);
    expect(graph.get("src/b.ts")?.fanIn).toBe(2);
    expect(graph.get("src/b.ts")?.dependents).toEqual(["src/a.ts", "src/c.ts"]);
    expect(graph.get("src/a.ts")?.imports).toEqual(["src/b.ts"]);
  });
});
