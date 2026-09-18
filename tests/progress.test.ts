import { describe, expect, test } from "bun:test";
import {
  createProgress,
  formatDuration,
  formatProgressLine,
  type ProgressIO,
} from "../src/report/progress";

interface Fake {
  stream: NodeJS.WriteStream;
  writes: string[];
  cursor: string[];
}

function fake(options: { isTTY?: boolean; columns?: number } = {}): Fake {
  const writes: string[] = [];
  const cursor: string[] = [];
  const stream = {
    isTTY: options.isTTY ?? true,
    columns: options.columns ?? 60,
    write(chunk: string): boolean {
      writes.push(chunk);
      return true;
    },
    cursorTo(column: number): void {
      cursor.push(`cursor:${column}`);
    },
    clearLine(): void {
      cursor.push("clear");
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, writes, cursor };
}

function controller(): { ticks: Array<() => void> } & ProgressIO {
  const ticks: Array<() => void> = [];
  const schedule = (tick: () => void): (() => void) => {
    ticks.push(tick);
    return () => {};
  };
  return { ticks, schedule };
}

describe("formatProgressLine", () => {
  test("renders counters, usage, elapsed and a truncated file", () => {
    const line = formatProgressLine(
      {
        label: "reviewing",
        fields: {
          current: 42,
          total: 180,
          calls: 30,
          cached: 12,
          tokens: 6300,
          file: "src/very/long/path/to/module.ts",
        },
        frame: 0,
        elapsedMs: 18_000,
      },
      80,
      false,
    );

    expect(line).toContain("42/180");
    expect(line).toContain("30 calls");
    expect(line).toContain("12 cached");
    expect(line).toContain("6,300 in");
    expect(line).toContain("18s");
    expect(line).toContain("…");
    expect(line.length).toBeLessThanOrEqual(80);
  });

  test("omits zero usage fields", () => {
    const line = formatProgressLine(
      {
        label: "reviewing",
        fields: { current: 0, total: 4, calls: 0, cached: 0 },
        frame: 0,
        elapsedMs: 0,
      },
      80,
      false,
    );

    expect(line).toContain("0/4");
    expect(line).not.toContain("calls");
    expect(line).not.toContain("cached");
  });

  test("formats durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(18_000)).toBe("18s");
    expect(formatDuration(65_000)).toBe("1m05s");
  });
});

describe("createProgress", () => {
  test("is silent when disabled and prints the summary plainly", () => {
    const { stream, writes } = fake();
    const progress = createProgress({ stream, enabled: false });

    progress.phase("reviewing", { current: 0, total: 2 });
    progress.update({ current: 1, file: "src/a.ts" });
    progress.done("scanned 2 units");

    expect(progress.enabled).toBe(false);
    expect(writes).toEqual(["scanned 2 units\n"]);
  });

  test("draws in place, animates on tick and finalizes with a check line", () => {
    const { stream, writes, cursor } = fake();
    const { ticks, schedule } = controller();
    const progress = createProgress({
      stream,
      enabled: true,
      color: false,
      columns: 80,
      now: () => 1_000,
      schedule,
    });

    progress.phase("reviewing", { current: 0, total: 2 });
    expect(writes.join("")).toContain("reviewing");
    expect(cursor.length).toBeGreaterThan(0);

    progress.update({ current: 1, cached: 1, calls: 1, file: "src/a.ts" });
    ticks[0]?.();

    const latest = writes[writes.length - 1] ?? "";
    expect(latest).toContain("1/2");
    expect(latest).toContain("src/a.ts");

    progress.done("scanned 2 units");
    const last = writes[writes.length - 1] ?? "";
    expect(last).toContain("scanned 2 units");
    expect(last.endsWith("\n")).toBe(true);
  });

  test("starts a fresh phase after done", () => {
    const { stream, writes } = fake();
    const { ticks, schedule } = controller();
    const progress = createProgress({ stream, enabled: true, color: false, columns: 80, schedule });

    progress.phase("reviewing", { current: 0, total: 2 });
    progress.update({ current: 2, calls: 2, tokens: 900 });
    progress.done("scanned 2 units");

    const before = writes.length;
    progress.phase("searching the map");
    const line = writes[writes.length - 1] ?? "";

    expect(writes.length).toBeGreaterThan(before);
    expect(line).toContain("searching the map");
    expect(line).not.toContain("2/2");
    expect(ticks.length).toBeGreaterThan(1);
  });

  test("stop erases without a summary line", () => {
    const { stream, writes, cursor } = fake();
    const progress = createProgress({
      stream,
      enabled: true,
      color: false,
      columns: 80,
      schedule: () => () => {},
    });

    progress.phase("reviewing", { current: 0, total: 2 });
    const drawn = writes.length;
    const cleared = cursor.filter((entry) => entry === "clear").length;

    progress.stop();

    expect(writes.length).toBe(drawn);
    expect(cursor.filter((entry) => entry === "clear").length).toBeGreaterThan(cleared);
  });

  test("gates on TTY and the environment override", () => {
    expect(createProgress({ stream: fake({ isTTY: false }).stream }).enabled).toBe(false);

    process.env.DARKOPS_NO_PROGRESS = "1";
    try {
      expect(createProgress({ stream: fake({ isTTY: true }).stream }).enabled).toBe(false);
    } finally {
      delete process.env.DARKOPS_NO_PROGRESS;
    }
  });
});
