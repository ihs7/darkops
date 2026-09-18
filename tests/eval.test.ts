import { describe, expect, test } from "bun:test";
import { formatEconomics } from "../src/eval/format";
import { BENCHMARK_QUERIES } from "../src/eval/queries";
import { buildCostFromUsage, summarize, type EconomicsReport } from "../src/eval/report";

function report(overrides: Partial<EconomicsReport> = {}): EconomicsReport {
  return {
    root: "/repo",
    model: "jev-test",
    startedAt: "2026-09-19T00:00:00.000Z",
    cold: {
      calls: 100,
      cached: 0,
      failed: 0,
      inputTokens: 1_000_000,
      outputTokens: 0,
      elapsedMs: 1000,
    },
    warm: { calls: 0, cached: 100, failed: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 50 },
    queries: [
      {
        intent: "a",
        inputTokens: 2000,
        outputTokens: 0,
        steps: 4,
        stop: "exhausted",
        elapsedMs: 10,
      },
      { intent: "b", inputTokens: 4000, outputTokens: 0, steps: 6, stop: "budget", elapsedMs: 20 },
    ],
    ...overrides,
  };
}

describe("buildCostFromUsage", () => {
  test("maps run usage fields and elapsed time", () => {
    const cost = buildCostFromUsage(
      { calls: 3, cached: 7, failed: 1, inputTokens: 123, outputTokens: 45 },
      999,
    );
    expect(cost).toEqual({
      calls: 3,
      cached: 7,
      failed: 1,
      inputTokens: 123,
      outputTokens: 45,
      elapsedMs: 999,
    });
  });
});

describe("summarize", () => {
  test("totals cold, warm, and query tokens", () => {
    const summary = summarize(report());
    expect(summary.coldInputTokens).toBe(1_000_000);
    expect(summary.warmInputTokens).toBe(0);
    expect(summary.queryInputTokens).toBe(6000);
    expect(summary.totalInputTokens).toBe(1_006_000);
  });

  test("reports mean and median query tokens", () => {
    const summary = summarize(report());
    expect(summary.queryMeanTokens).toBe(3000);
    expect(summary.queryMedianTokens).toBe(3000);
  });

  test("computes the warm cache hit rate", () => {
    expect(summarize(report()).warmCacheHitRate).toBe(1);
  });

  test("handles a run with no queries", () => {
    const summary = summarize(report({ queries: [] }));
    expect(summary.queryMeanTokens).toBe(0);
    expect(summary.queryMedianTokens).toBe(0);
    expect(summary.queryInputTokens).toBe(0);
  });

  test("computes median for an even and odd count", () => {
    const odd = summarize(
      report({
        queries: [
          {
            intent: "a",
            inputTokens: 100,
            outputTokens: 0,
            steps: 1,
            stop: "exhausted",
            elapsedMs: 1,
          },
          {
            intent: "b",
            inputTokens: 300,
            outputTokens: 0,
            steps: 1,
            stop: "exhausted",
            elapsedMs: 1,
          },
          {
            intent: "c",
            inputTokens: 200,
            outputTokens: 0,
            steps: 1,
            stop: "exhausted",
            elapsedMs: 1,
          },
        ],
      }),
    );
    expect(odd.queryMedianTokens).toBe(200);
    const even = summarize(
      report({
        queries: [
          {
            intent: "a",
            inputTokens: 100,
            outputTokens: 0,
            steps: 1,
            stop: "exhausted",
            elapsedMs: 1,
          },
          {
            intent: "b",
            inputTokens: 400,
            outputTokens: 0,
            steps: 1,
            stop: "exhausted",
            elapsedMs: 1,
          },
        ],
      }),
    );
    expect(even.queryMedianTokens).toBe(250);
  });
});

describe("formatEconomics", () => {
  test("prints cold, warm, query, and total lines", () => {
    const sample = report();
    const output = formatEconomics(sample, summarize(sample));
    expect(output).toContain("cold build");
    expect(output).toContain("warm build");
    expect(output).toContain("queries");
    expect(output).toContain("total");
    expect(output).toContain("/repo");
    expect(output).toContain("jev-test");
  });

  test("omits the cold line when there was no cold scan", () => {
    const sample = report({ cold: null });
    const output = formatEconomics(sample, summarize(sample));
    expect(output).not.toContain("cold build");
    expect(output).toContain("warm build");
  });
});

describe("BENCHMARK_QUERIES", () => {
  test("is a non-empty, unique list of intents", () => {
    expect(BENCHMARK_QUERIES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(BENCHMARK_QUERIES).size).toBe(BENCHMARK_QUERIES.length);
    for (const intent of BENCHMARK_QUERIES) {
      expect(intent.trim().length).toBeGreaterThan(0);
    }
  });
});
