import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHistory } from "../src/harness/history";
import { git } from "./support/git";

const roots: string[] = [];

async function commit(root: string, author: string, message: string): Promise<void> {
  await git(root, ["add", "."]);
  await git(root, [
    "-c",
    `user.name=${author}`,
    "-c",
    `user.email=${author}@example.com`,
    "commit",
    "-q",
    "-m",
    message,
  ]);
}

async function scaffold(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "darkops-history-"));
  roots.push(root);
  await git(root, ["init", "-q", "-b", "main"]);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await commit(root, "Alice", "feat: add a");
  await writeFile(join(root, "src", "b.ts"), "export const b = 1;\n");
  await commit(root, "Alice", "fix: add b");
  await writeFile(join(root, "src", "a.ts"), "export const a = 2;\n");
  await writeFile(join(root, "src", "b.ts"), "export const b = 2;\n");
  await commit(root, "Bob", "fix: change both");
  await writeFile(join(root, "src", "a.ts"), "export const a = 3;\n");
  await writeFile(join(root, "src", "b.ts"), "export const b = 3;\n");
  await commit(root, "Bob", "bug: change both again");
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("collectHistory", () => {
  test("derives churn, ownership, bug fixes, and change coupling", async () => {
    const root = await scaffold();
    const result = await collectHistory({
      root,
      paths: new Set(["src/a.ts", "src/b.ts"]),
      minCoChanges: 2,
    });

    const a = result.files.get("src/a.ts");
    const b = result.files.get("src/b.ts");

    expect(result.commits).toBe(4);
    expect(a?.commits).toBe(3);
    expect(a?.recentCommits).toBe(3);
    expect(a?.authors).toBe(2);
    expect(a?.bugFixCommits).toBe(2);
    expect(b?.bugFixCommits).toBe(3);
    expect(a?.couplings[0]?.path).toBe("src/b.ts");
    expect(a?.couplings[0]?.coChanges).toBe(2);
    expect(a?.sumCoupling).toBe(1);
  });
});
