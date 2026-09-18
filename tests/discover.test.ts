import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSourceUnits } from "../src/harness/discover";
import { git } from "./support/git";

const roots: string[] = [];

async function scaffoldRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "darkops-discover-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "ignored"), { recursive: true });
  await mkdir(join(root, "scratch"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "src", "b.test.ts"), "export const b = 1;\n");
  await writeFile(join(root, "src", "types.d.ts"), "export type A = 1;\n");
  await writeFile(join(root, "src", "bundle.min.ts"), "export const m = 1;\n");
  await writeFile(join(root, "ignored", "x.ts"), "export const x = 1;\n");
  await writeFile(join(root, "scratch", "skip.ts"), "export const skip = 1;\n");
  await writeFile(join(root, "node_modules", "pkg", "index.ts"), "export const x = 1;\n");
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await writeFile(join(root, ".darkopsignore"), "scratch/\n");
  await git(root, ["init", "-q"]);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverSourceUnits", () => {
  test("uses git to exclude ignored files and classify units", async () => {
    const root = await scaffoldRepo();
    const result = await discoverSourceUnits({ root });
    const paths = result.units.map((unit) => unit.relPath);

    expect(result.mode).toBe("git");
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/b.test.ts");
    expect(paths).not.toContain("src/types.d.ts");
    expect(paths).not.toContain("src/bundle.min.ts");
    expect(paths).not.toContain("ignored/x.ts");
    expect(paths).not.toContain("scratch/skip.ts");
    expect(paths.some((path) => path.includes("node_modules"))).toBe(false);
    expect(result.units.find((unit) => unit.relPath === "src/a.ts")?.kind).toBe("source");
    expect(result.units.find((unit) => unit.relPath === "src/b.test.ts")?.kind).toBe("test");
  });

  test("records oversized files instead of scoring them", async () => {
    const root = await scaffoldRepo();
    const result = await discoverSourceUnits({ root, maxBytes: 10 });

    expect(result.units).toHaveLength(0);
    expect(result.skipped.map((file) => file.relPath)).toContain("src/a.ts");
    expect(result.skipped.every((file) => file.reason === "too_large")).toBe(true);
  });

  test("falls back to a filesystem walk outside a git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "darkops-walk-"));
    roots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");

    const result = await discoverSourceUnits({ root });
    expect(result.mode).toBe("walk");
    expect(result.units.map((unit) => unit.relPath)).toContain("src/a.ts");
  });
});
