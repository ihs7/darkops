import { describe, expect, test } from "bun:test";
import { navKey, pruneNavCache, readNav, writeNav, type NavCache } from "../src/state/nav-cache";

describe("navKey", () => {
  test("is stable for identical inputs", () => {
    const parts = ["rank", "jev-test", "improve", { a: "one" }] as const;
    expect(navKey(...parts)).toBe(navKey(...parts));
  });

  test("separates kind, model, intent, and payload", () => {
    const base = navKey("rank", "jev-test", "intent", { a: "one" });
    expect(navKey("score", "jev-test", "intent", { a: "one" })).not.toBe(base);
    expect(navKey("rank", "other", "intent", { a: "one" })).not.toBe(base);
    expect(navKey("rank", "jev-test", "other", { a: "one" })).not.toBe(base);
    expect(navKey("rank", "jev-test", "intent", { a: "two" })).not.toBe(base);
  });
});

describe("readNav / writeNav", () => {
  test("round-trips a value", () => {
    const cache: NavCache = {};
    writeNav(cache, "k", "jev-test", { choice: "a" });
    expect(readNav<{ choice: string }>(cache, "k")).toEqual({ choice: "a" });
  });

  test("returns undefined for a miss", () => {
    expect(readNav({}, "missing")).toBeUndefined();
  });
});

describe("pruneNavCache", () => {
  test("keeps the newest entries up to the limit", () => {
    const cache: NavCache = {
      old: { key: "old", model: "m", createdAt: "2026-01-01T00:00:00.000Z", value: 1 },
      recent: { key: "recent", model: "m", createdAt: "2026-06-01T00:00:00.000Z", value: 2 },
      newest: { key: "newest", model: "m", createdAt: "2026-09-01T00:00:00.000Z", value: 3 },
    };

    expect(Object.keys(pruneNavCache(cache, 2)).sort()).toEqual(["newest", "recent"]);
  });
});
