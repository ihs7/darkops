import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ISOLATED_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export async function git(root: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, "-c", "commit.gpgsign=false", ...args], {
    env: { ...process.env, ...ISOLATED_ENV },
  });
}
