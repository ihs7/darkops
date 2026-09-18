import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Commit, CommitMoment } from "./types";

const execFileAsync = promisify(execFile);

const BUGFIX = /\b(fix(es|ed)?|bug|hotfix|revert|regression|broken)\b/i;
const REVERT = /\brevert\b/i;
const BOT = /(\[bot\]|bot$|dependabot|renovate|github-actions)/i;
const FIELD = "\u001f";
const RECORD = "\u001e";

export function commitMoment(commit: Commit, cutoff: number): CommitMoment {
  return {
    date: commit.date,
    recent: Date.parse(commit.date) >= cutoff,
    bot: BOT.test(commit.author),
    bugfix: BUGFIX.test(commit.subject),
    revert: REVERT.test(commit.subject),
  };
}

export async function readCommits(root: string, maxCommits: number): Promise<Commit[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "log",
        "--no-merges",
        "--name-only",
        "-n",
        String(maxCommits),
        `--pretty=format:%x1e%H${FIELD}%an${FIELD}%aI${FIELD}%s`,
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    return parseLog(stdout);
  } catch {
    return [];
  }
}

export function parseLog(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const chunk of output.split(RECORD)) {
    const text = chunk.trim();
    if (!text) continue;
    const lines = text.split("\n");
    const header = lines[0] as string;
    const parts = header.split(FIELD);
    if (parts.length < 4) continue;
    const [, author, date, ...rest] = parts;
    const files = lines
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    commits.push({
      author: author as string,
      date: date as string,
      subject: rest.join(FIELD),
      files,
    });
  }
  return commits;
}
