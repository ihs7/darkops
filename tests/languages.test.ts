import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceUnit } from "../src/harness/discover";
import { buildGraph } from "../src/harness/graph";
import { adapterFor, isSourcePath, isTestPath } from "../src/harness/languages";
import { goLanguage, readGoModule } from "../src/harness/languages/go";
import { pythonLanguage } from "../src/harness/languages/python";
import { rustLanguage } from "../src/harness/languages/rust";
import { typescriptLanguage } from "../src/harness/languages/typescript";

const roots: string[] = [];

function unit(relPath: string, content: string): SourceUnit {
  return { path: relPath, relPath, kind: "source", content, hash: relPath, bytes: 1, lines: 1 };
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("language registry", () => {
  test("recognizes each language by extension", () => {
    expect(adapterFor("a.ts")?.id).toBe("typescript");
    expect(adapterFor("a.js")?.id).toBe("typescript");
    expect(adapterFor("a.py")?.id).toBe("python");
    expect(adapterFor("a.go")?.id).toBe("go");
    expect(adapterFor("a.rs")?.id).toBe("rust");
    expect(adapterFor("a.rb")).toBeUndefined();
  });

  test("treats declarations as non-source and detects tests", () => {
    expect(isSourcePath("a.d.ts")).toBe(false);
    expect(isSourcePath("a.pyi")).toBe(false);
    expect(isSourcePath("a.js")).toBe(true);
    expect(isTestPath("src/a.test.ts")).toBe(true);
    expect(isTestPath("pkg/test_api.py")).toBe(true);
    expect(isTestPath("pkg/api_test.py")).toBe(true);
    expect(isTestPath("internal/foo/foo_test.go")).toBe(true);
    expect(isTestPath("tests/integration.rs")).toBe(true);
  });
});

describe("typescript/javascript adapter", () => {
  test("parses JavaScript imports and exports", () => {
    const facts = typescriptLanguage.extractModuleFacts(
      'import x from "./b";\nexport const y = 1;\n',
      "a.js",
    );
    expect(facts.runtimeImports).toEqual(["./b"]);
    expect(facts.runtimeExports).toEqual(["y"]);
  });

  test("resolves a JavaScript relative import", () => {
    const set = new Set(["src/b.js"]);
    expect(typescriptLanguage.resolveSpecifiers("src/a.js", "./b", set, {})).toEqual(["src/b.js"]);
  });

  test("parses CommonJS require and exports", () => {
    const facts = typescriptLanguage.extractModuleFacts(
      'const a = require("./b");\nexports.c = 1;\nmodule.exports = { d, e };\n',
      "a.js",
    );
    expect(facts.runtimeImports).toContain("./b");
    expect(facts.runtimeExports).toEqual(expect.arrayContaining(["c", "d", "e"]));
  });
});

describe("python adapter", () => {
  test("extracts import and from-import forms", () => {
    const facts = pythonLanguage.extractModuleFacts(
      "import os, sys\nfrom pkg.util import helper\nfrom . import sibling\n",
      "pkg/mod.py",
    );
    expect(facts.runtimeImports).toEqual(["os", "sys", "pkg.util", ".sibling"]);
  });

  test("exports public top-level definitions only", () => {
    const facts = pythonLanguage.extractModuleFacts(
      "def api():\n    pass\nclass Thing:\n    pass\ndef _private():\n    pass\n",
      "pkg/mod.py",
    );
    expect(facts.runtimeExports).toEqual(["api", "Thing"]);
  });

  test("resolves absolute, package, and relative imports", () => {
    const set = new Set(["pkg/__init__.py", "pkg/mod.py", "pkg/sibling.py"]);
    expect(pythonLanguage.resolveSpecifiers("app.py", "pkg.mod", set, {})).toEqual(["pkg/mod.py"]);
    expect(pythonLanguage.resolveSpecifiers("pkg/mod.py", ".", set, {})).toEqual([
      "pkg/__init__.py",
    ]);
    expect(pythonLanguage.resolveSpecifiers("pkg/mod.py", ".sibling", set, {})).toEqual([
      "pkg/sibling.py",
    ]);
  });

  test("counts functions and decisions", () => {
    const facts = pythonLanguage.analyzeComplexity(
      "def f(x):\n    if x:\n        return 1\n    return 2\n\ndef g():\n    for i in range(3):\n        if i:\n            pass\n",
      "m.py",
    );
    expect(facts.functions).toBe(2);
    expect(facts.maxCyclomatic).toBe(3);
  });
});

describe("go adapter", () => {
  test("extracts block, single, and aliased imports", () => {
    const facts = goLanguage.extractModuleFacts(
      'package main\n\nimport (\n\t"fmt"\n\talias "example.com/mod/internal/foo"\n\t_ "embed"\n)\n\nimport "strings"\n',
      "main.go",
    );
    expect(facts.runtimeImports).toEqual([
      "fmt",
      "example.com/mod/internal/foo",
      "embed",
      "strings",
    ]);
  });

  test("resolves a local package to its non-test files", () => {
    const set = new Set([
      "internal/foo/foo.go",
      "internal/foo/bar.go",
      "internal/foo/foo_test.go",
      "cmd/main.go",
    ]);
    expect(
      goLanguage.resolveSpecifiers("cmd/main.go", "example.com/mod/internal/foo", set, {
        goModule: "example.com/mod",
      }),
    ).toEqual(["internal/foo/bar.go", "internal/foo/foo.go"]);
    expect(goLanguage.resolveSpecifiers("cmd/main.go", "fmt", set, {})).toEqual([]);
  });

  test("reads the module path from go.mod", async () => {
    const root = await mkdtemp(join(tmpdir(), "darkops-go-"));
    roots.push(root);
    await writeFile(join(root, "go.mod"), "module example.com/mod\n\ngo 1.22\n");
    expect(await readGoModule(root)).toBe("example.com/mod");
  });

  test("counts functions and decisions", () => {
    const facts = goLanguage.analyzeComplexity(
      "package m\n\nfunc A(x int) int {\n\tif x > 0 {\n\t\treturn 1\n\t}\n\treturn 0\n}\n\nfunc B() {\n\tfor i := 0; i < 3; i++ {\n\t\tif i == 1 {\n\t\t\tcontinue\n\t\t}\n\t}\n}\n",
      "a.go",
    );
    expect(facts.functions).toBe(2);
    expect(facts.maxCyclomatic).toBe(3);
  });
});

describe("rust adapter", () => {
  test("expands use groups and module declarations", () => {
    const facts = rustLanguage.extractModuleFacts(
      "use crate::a::b;\nuse crate::c::{d, e as f};\nuse super::g;\nmod h;\n\npub fn api() {}\npub struct Thing;\n",
      "a.rs",
    );
    expect(facts.runtimeImports).toEqual([
      "crate::a::b",
      "crate::c::d",
      "crate::c::e",
      "super::g",
      "mod:h",
    ]);
    expect(facts.runtimeExports).toEqual(["api", "Thing"]);
  });

  test("resolves crate, self, super, and module paths", () => {
    const set = new Set(["src/c/d.rs", "src/a/z.rs", "src/a/c.rs", "src/h.rs", "src/a/b.rs"]);
    expect(rustLanguage.resolveSpecifiers("src/a/b.rs", "crate::c::d", set, {})).toEqual([
      "src/c/d.rs",
    ]);
    expect(rustLanguage.resolveSpecifiers("src/a/b.rs", "super::z", set, {})).toEqual([
      "src/a/z.rs",
    ]);
    expect(rustLanguage.resolveSpecifiers("src/a.rs", "self::c", set, {})).toEqual(["src/a/c.rs"]);
    expect(rustLanguage.resolveSpecifiers("src/lib.rs", "mod:h", set, {})).toEqual(["src/h.rs"]);
  });

  test("resolves crate paths inside a nested workspace member", () => {
    const set = new Set([
      "apps/desktop/src-tauri/src/board/geometry.rs",
      "apps/desktop/src-tauri/src/board/mod.rs",
    ]);
    const from = "apps/desktop/src-tauri/src/board/fusion.rs";
    expect(rustLanguage.resolveSpecifiers(from, "crate::board::geometry", set, {})).toEqual([
      "apps/desktop/src-tauri/src/board/geometry.rs",
    ]);
    expect(rustLanguage.resolveSpecifiers(from, "crate::board", set, {})).toEqual([
      "apps/desktop/src-tauri/src/board/mod.rs",
    ]);
  });

  test("counts functions and decisions", () => {
    const facts = rustLanguage.analyzeComplexity(
      "fn a(x: i32) -> i32 {\n    if x > 0 { 1 } else { 2 }\n}\n\nfn b() {\n    for i in 0..3 {\n        match i { 0 => {}, _ => {} }\n    }\n}\n",
      "a.rs",
    );
    expect(facts.functions).toBe(2);
    expect(facts.maxCyclomatic).toBe(3);
  });

  test("does not treat lifetimes as string literals", () => {
    const facts = rustLanguage.analyzeComplexity(
      "fn f<'a>(x: &'a str) -> &'a str {\n    if x.is_empty() {\n        return x;\n    }\n    x\n}\n",
      "a.rs",
    );
    expect(facts.functions).toBe(1);
    expect(facts.maxCyclomatic).toBe(2);
  });
});

describe("buildGraph across languages", () => {
  test("resolves edges for TypeScript, Python, Go, and Rust", async () => {
    const root = await mkdtemp(join(tmpdir(), "darkops-lang-"));
    roots.push(root);
    await writeFile(join(root, "go.mod"), "module example.com/mod\n");

    const units = [
      unit("src/a.ts", 'import { b } from "./b";'),
      unit("src/b.ts", "export const b = 1;"),
      unit("pkg/mod.py", "from . import sibling"),
      unit("pkg/sibling.py", "x = 1"),
      unit("src/a.rs", "use crate::b;"),
      unit("src/b.rs", "pub fn b() {}"),
      unit("internal/foo/foo.go", "package foo"),
      unit("cmd/main.go", 'package main\nimport "example.com/mod/internal/foo"'),
    ];

    const { graph } = await buildGraph(units, { root });

    expect(graph.get("src/b.ts")?.fanIn).toBe(1);
    expect(graph.get("pkg/sibling.py")?.fanIn).toBe(1);
    expect(graph.get("src/b.rs")?.fanIn).toBe(1);
    expect(graph.get("internal/foo/foo.go")?.fanIn).toBe(1);
  });
});
