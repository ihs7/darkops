import { describe, expect, test } from "bun:test";
import { withDefaultCommand } from "../src/util/args";

describe("withDefaultCommand", () => {
  test("routes a bare quoted query to the default run command", () => {
    expect(withDefaultCommand(["node", "cli.js", "improve maintainability"])).toEqual([
      "node",
      "cli.js",
      "run",
      "improve maintainability",
    ]);
  });

  test("routes an unquoted multi-word query", () => {
    expect(withDefaultCommand(["node", "cli.js", "improve", "maintainability"])).toEqual([
      "node",
      "cli.js",
      "run",
      "improve",
      "maintainability",
    ]);
  });

  test("routes a bare invocation to the default command", () => {
    expect(withDefaultCommand(["node", "cli.js"])).toEqual(["node", "cli.js", "run"]);
  });

  test("leaves known commands untouched", () => {
    expect(withDefaultCommand(["node", "cli.js", "usage", "--json"])).toEqual([
      "node",
      "cli.js",
      "usage",
      "--json",
    ]);
    expect(withDefaultCommand(["node", "cli.js", "mcp"])).toEqual(["node", "cli.js", "mcp"]);
    expect(withDefaultCommand(["node", "cli.js", "auth", "--show"])).toEqual([
      "node",
      "cli.js",
      "auth",
      "--show",
    ]);
  });

  test("leaves help and version untouched", () => {
    expect(withDefaultCommand(["node", "cli.js", "--help"])).toEqual(["node", "cli.js", "--help"]);
    expect(withDefaultCommand(["node", "cli.js", "--version"])).toEqual([
      "node",
      "cli.js",
      "--version",
    ]);
  });

  test("keeps flags before a bare query", () => {
    expect(withDefaultCommand(["node", "cli.js", "--root", ".", "improve"])).toEqual([
      "node",
      "cli.js",
      "run",
      "--root",
      ".",
      "improve",
    ]);
  });

  test("does not mistake a flag value for the command", () => {
    expect(withDefaultCommand(["node", "cli.js", "--root", ".", "usage"])).toEqual([
      "node",
      "cli.js",
      "--root",
      ".",
      "usage",
    ]);
    expect(withDefaultCommand(["node", "cli.js", "-r", "/tmp/repo", "schema"])).toEqual([
      "node",
      "cli.js",
      "-r",
      "/tmp/repo",
      "schema",
    ]);
    expect(withDefaultCommand(["node", "cli.js", "--run", "run_1", "usage", "--json"])).toEqual([
      "node",
      "cli.js",
      "--run",
      "run_1",
      "usage",
      "--json",
    ]);
  });
});
