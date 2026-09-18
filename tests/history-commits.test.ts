import { describe, expect, test } from "bun:test";
import { commitMoment, parseLog } from "../src/harness/history/commits";

const FIELD = "\u001f";
const RECORD = "\u001e";

describe("parseLog", () => {
  test("parses record- and field-separated git log output", () => {
    const output = [
      `${RECORD}abc${FIELD}Ada${FIELD}2026-01-01T00:00:00Z${FIELD}fix a bug`,
      "src/a.ts",
      "src/b.ts",
      `${RECORD}def${FIELD}Bob${FIELD}2026-01-02T00:00:00Z${FIELD}add feature`,
      "src/c.ts",
    ].join("\n");

    const commits = parseLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      author: "Ada",
      date: "2026-01-01T00:00:00Z",
      subject: "fix a bug",
      files: ["src/a.ts", "src/b.ts"],
    });
    expect(commits[1]?.files).toEqual(["src/c.ts"]);
  });

  test("skips malformed headers", () => {
    expect(parseLog(`${RECORD}only-one-field`)).toEqual([]);
  });
});

describe("commitMoment", () => {
  test("classifies recency, bot authors, and bug fixes", () => {
    const moment = commitMoment(
      { author: "Ada", date: new Date().toISOString(), subject: "fix crash", files: [] },
      Date.now() - 1000,
    );
    expect(moment.recent).toBe(true);
    expect(moment.bugfix).toBe(true);
    expect(moment.bot).toBe(false);
  });

  test("flags bot authors", () => {
    const moment = commitMoment(
      { author: "dependabot[bot]", date: new Date().toISOString(), subject: "bump", files: [] },
      Date.now() - 1000,
    );
    expect(moment.bot).toBe(true);
    expect(moment.bugfix).toBe(false);
  });
});
