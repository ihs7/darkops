import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRun } from "../src/commands/ensure";
import { repositoryFingerprint, stateDir, type RunRecord } from "../src/state/store";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; record: RunRecord }> {
  const root = await mkdtemp(join(tmpdir(), "darkops-ensure-"));
  roots.push(root);
  process.env.DARKOPS_STATE_DIR = join(root, "state");
  const state = stateDir(root);

  const dir = join(state, "runs", "run_x");
  await mkdir(dir, { recursive: true });
  const record: RunRecord = {
    id: "run_x",
    startedAt: "",
    finishedAt: "",
    root,
    mode: "git",
    model: "jev-test",
    fingerprint: repositoryFingerprint([], []),
    commit: null,
    counts: { total: 1, scored: 1, failed: 0, skipped: 0 },
    usage: { calls: 0, cached: 0, failed: 0, inputTokens: 0, outputTokens: 0 },
    skipped: [],
    units: [],
  };
  await writeFile(join(dir, "scan.json"), JSON.stringify(record));
  await writeFile(join(state, "latest.json"), JSON.stringify({ id: "run_x" }));
  return { root, record };
}

afterAll(async () => {
  delete process.env.DARKOPS_STATE_DIR;
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("ensureRun", () => {
  test("returns the latest run without scanning when the tree is unchanged", async () => {
    const { root, record } = await fixture();
    let called = false;
    const { record: got, scanned } = await ensureRun({
      root,
      scan: async () => {
        called = true;
        return record;
      },
    });

    expect(got.id).toBe("run_x");
    expect(scanned).toBe(false);
    expect(called).toBe(false);
  });

  test("rescans when the tree changed", async () => {
    const { root, record } = await fixture();
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
    let called = 0;

    const { scanned } = await ensureRun({
      root,
      scan: async () => {
        called += 1;
        return { ...record, id: "run_y" };
      },
    });

    expect(scanned).toBe(true);
    expect(called).toBe(1);
  });

  test("rescans a legacy run that has no fingerprint", async () => {
    const { root, record } = await fixture();
    const legacy = { ...record, fingerprint: undefined };
    await writeFile(join(stateDir(root), "runs", "run_x", "scan.json"), JSON.stringify(legacy));
    let called = 0;

    await ensureRun({
      root,
      scan: async () => {
        called += 1;
        return record;
      },
    });

    expect(called).toBe(1);
  });

  test("rescans a legacy structural run", async () => {
    const { root, record } = await fixture();
    const legacy = { ...record, model: "structural" };
    await writeFile(join(stateDir(root), "runs", "run_x", "scan.json"), JSON.stringify(legacy));
    let called = 0;

    const { scanned } = await ensureRun({
      root,
      scan: async () => {
        called += 1;
        return record;
      },
    });

    expect(scanned).toBe(true);
    expect(called).toBe(1);
  });

  test("loads a specific run by id", async () => {
    const { root } = await fixture();
    const { record } = await ensureRun({ root, runId: "run_x" });

    expect(record.id).toBe("run_x");
  });

  test("throws for an unknown run id", async () => {
    const { root } = await fixture();

    await expect(ensureRun({ root, runId: "nope" })).rejects.toThrow();
  });
});
