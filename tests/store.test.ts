import { describe, expect, test } from "bun:test";
import type { ComplexityFacts } from "../src/harness/complexity";
import type { UnitGraph } from "../src/harness/graph";
import type { FileHistory } from "../src/harness/history";
import {
  answerKey,
  graphFingerprint,
  pruneCache,
  repositoryFingerprint,
  stateFingerprint,
  type Cache,
  type CacheEntry,
} from "../src/state/store";

function graph(overrides: Partial<UnitGraph> = {}): UnitGraph {
  return {
    fanIn: 0,
    fanOut: 0,
    imports: [],
    dependents: [],
    typeImports: 0,
    exports: [],
    typeExports: 0,
    ...overrides,
  };
}

function entry(key: string): CacheEntry {
  return {
    key,
    hash: "h",
    relPath: "a.ts",
    model: "jev-test",
    createdAt: "",
    answers: {} as CacheEntry["answers"],
  };
}

describe("answerKey", () => {
  test("is stable for identical inputs", () => {
    const parts = { hash: "h", model: "jev-test", state: "s" };
    expect(answerKey(parts)).toBe(answerKey({ ...parts }));
  });

  test("changes when the state fingerprint changes", () => {
    const base = { hash: "h", model: "jev-test" };
    expect(answerKey({ ...base, state: "s1" })).not.toBe(answerKey({ ...base, state: "s2" }));
  });

  test("treats a missing state the same as an empty one", () => {
    expect(answerKey({ hash: "h", model: "m" })).toBe(
      answerKey({ hash: "h", model: "m", state: "" }),
    );
  });
});

describe("stateFingerprint", () => {
  const withHistory = (overrides: Partial<FileHistory> = {}): FileHistory => ({
    commits: 10,
    recentCommits: 4,
    authors: 3,
    recentAuthors: 2,
    primaryAuthorShare: 0.5,
    bugFixCommits: 2,
    revertCommits: 0,
    lastModified: "2026-01-01T00:00:00Z",
    firstSeen: "2025-01-01T00:00:00Z",
    sumCoupling: 1,
    couplings: [{ path: "c.ts", coChanges: 5, strength: 0.7 }],
    ...overrides,
  });

  const complexity: ComplexityFacts = {
    functions: 5,
    totalCyclomatic: 20,
    maxCyclomatic: 9,
    maxNesting: 4,
    maxFunctionLines: 80,
  };

  test("is stable for identical state", () => {
    const parts = { graph: graph(), history: withHistory(), complexity };
    expect(stateFingerprint(parts)).toBe(stateFingerprint(parts));
  });

  test("changes when history changes but content and graph do not", () => {
    const base = { graph: graph(), complexity };
    const before = stateFingerprint({ ...base, history: withHistory({ bugFixCommits: 2 }) });
    const after = stateFingerprint({ ...base, history: withHistory({ bugFixCommits: 9 }) });
    expect(before).not.toBe(after);
  });

  test("changes when complexity changes", () => {
    const base = { graph: graph(), history: withHistory() };
    expect(stateFingerprint({ ...base, complexity })).not.toBe(
      stateFingerprint({ ...base, complexity: { ...complexity, maxCyclomatic: 12 } }),
    );
  });

  test("is independent of coupling order", () => {
    const base = { graph: graph(), complexity };
    const first = withHistory({
      couplings: [
        { path: "b.ts", coChanges: 1, strength: 0.1 },
        { path: "a.ts", coChanges: 1, strength: 0.1 },
      ],
    });
    const second = withHistory({
      couplings: [
        { path: "a.ts", coChanges: 1, strength: 0.1 },
        { path: "b.ts", coChanges: 1, strength: 0.1 },
      ],
    });
    expect(stateFingerprint({ ...base, history: first })).toBe(
      stateFingerprint({ ...base, history: second }),
    );
  });
});

describe("graphFingerprint", () => {
  test("changes when dependents change but content does not", () => {
    const before = graphFingerprint(graph({ fanIn: 1, dependents: ["a.ts"] }));
    const after = graphFingerprint(graph({ fanIn: 2, dependents: ["a.ts", "b.ts"] }));
    expect(before).not.toBe(after);
  });

  test("ignores dependent ordering", () => {
    const first = graphFingerprint(graph({ fanIn: 2, dependents: ["b.ts", "a.ts"] }));
    const second = graphFingerprint(graph({ fanIn: 2, dependents: ["a.ts", "b.ts"] }));
    expect(first).toBe(second);
  });
});

describe("repositoryFingerprint", () => {
  test("ignores unit ordering", () => {
    const first = repositoryFingerprint(
      [
        { relPath: "b.ts", hash: "2" },
        { relPath: "a.ts", hash: "1" },
      ],
      [],
    );
    const second = repositoryFingerprint(
      [
        { relPath: "a.ts", hash: "1" },
        { relPath: "b.ts", hash: "2" },
      ],
      [],
    );
    expect(first).toBe(second);
  });

  test("changes when a unit's content changes", () => {
    expect(repositoryFingerprint([{ relPath: "a.ts", hash: "1" }], [])).not.toBe(
      repositoryFingerprint([{ relPath: "a.ts", hash: "2" }], []),
    );
  });
});

describe("pruneCache", () => {
  test("keeps only referenced entries", () => {
    const cache: Cache = { a: entry("a"), b: entry("b"), c: entry("c") };
    expect(Object.keys(pruneCache(cache, new Set(["a", "c"]))).sort()).toEqual(["a", "c"]);
  });

  test("drops a reference with no entry", () => {
    const cache: Cache = { a: entry("a") };
    expect(pruneCache(cache, new Set(["a", "missing"]))).toEqual({ a: cache.a as CacheEntry });
  });
});
