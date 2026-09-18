#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { runAuth } from "./commands/auth";
import { ensureRun } from "./commands/ensure";
import { runMcp } from "./commands/mcp";
import { collectUsage, totalUsage } from "./commands/usage";
import { runIntent, type IntentView } from "./map/intent";
import { formatIntent, formatScanSummary, formatUsage } from "./report/format";
import { manifest, VERSION } from "./report/manifest";
import { createProgress } from "./report/progress";
import { withDefaultCommand } from "./util/args";
import { requireCredentials } from "./util/credentials";
import { classifyError, CONTRACT_VERSION, errorEnvelope } from "./util/errors";

interface RunFlags {
  root: string;
  run?: string;
  path?: string;
  limit?: number;
  budget: number;
  minConfidence: number;
  force: boolean;
  json: boolean;
  fields?: string;
}

interface UsageFlags {
  root: string;
  limit: number;
  json: boolean;
}

interface McpFlags {
  root: string;
  run?: string;
  name?: string;
}

interface AuthFlags {
  root: string;
  key?: string;
  show: boolean;
}

const program = new Command();

program
  .name("darkops")
  .description("Search a repository map for where attention should go, powered by Jev.")
  .version(VERSION)
  .addHelpText(
    "after",
    [
      "",
      "The default command takes a query (it scans automatically when needed):",
      "",
      '  $ darkops "improve maintainability"   search the map for opportunities',
      '  $ darkops --force "..."               rebuild the map, ignoring caches',
      "  $ darkops mcp                         serve the evidence tools to agents",
      "  $ darkops auth --key ...              store the TypeSafe API key once",
      "  $ darkops schema                      print the machine contract",
      "",
    ].join("\n"),
  );

program
  .command("schema")
  .description("Print the versioned CLI contract as JSON.")
  .action(() => {
    console.log(JSON.stringify(manifest, null, 2));
  });

program
  .command("usage")
  .description("Show Jev token usage and estimated cost across runs.")
  .option("-r, --root <dir>", "repository root", process.cwd())
  .option("-l, --limit <n>", "runs to print", (value) => Number.parseInt(value, 10), 10)
  .option("--json", "print usage as JSON", false)
  .action(async (flags: UsageFlags) => {
    const rows = await collectUsage(flags.root);
    const totals = totalUsage(rows);
    console.log(
      wantsJson(flags.json)
        ? JSON.stringify({ contract: CONTRACT_VERSION, totals, rows }, null, 2)
        : formatUsage(rows, totals, flags.limit, tableOptions()),
    );
  });

program
  .command("mcp")
  .description("Serve the read-only tools (evidence, fleet, navigation) over MCP on stdio.")
  .option("-r, --root <dir>", "repository root", process.cwd())
  .option("--run <id>", "use a specific run instead of the latest")
  .option("--name <name>", "server name", "darkops")
  .action(async (flags: McpFlags) => {
    requireCredentials(flags.root);
    await runMcp({ root: flags.root, runId: flags.run, name: flags.name });
  });

program
  .command("auth")
  .description("Store the TypeSafe API key in the user config file.")
  .option("-r, --root <dir>", "repository root", process.cwd())
  .option("--key <key>", "API key to save (or pipe it on stdin)")
  .option("--show", "show where the API key resolves from", false)
  .action(async (flags: AuthFlags) => {
    await runAuth({ root: flags.root, key: flags.key, show: flags.show });
  });

program
  .command("run [query...]", { hidden: true })
  .description("Search the map for a query (default command).")
  .option("-r, --root <dir>", "repository root", process.cwd())
  .option("--run <id>", "use a specific run instead of the latest")
  .option("-p, --path <dir>", "scope the search to an area")
  .option(
    "-l, --limit <n>",
    "maximum results to print (default scales with repository size, min 5)",
    (value) => Number.parseInt(value, 10),
  )
  .option("--budget <n>", "maximum Jev judgments", (value) => Number.parseInt(value, 10), 12)
  .option(
    "--min-confidence <n>",
    "prune a branch when a Jev judgment falls below this",
    (value) => Number.parseFloat(value),
    0.2,
  )
  .option("--force", "rebuild the map now, ignoring all caches", false)
  .option("--json", "print as JSON", false)
  .option("--fields <list>", "comma-separated opportunity fields to include in JSON")
  .action(async (query: string[], flags: RunFlags) => {
    if (query.length === 0) {
      program.help();
      return;
    }

    const json = wantsJson(flags.json);
    const progress = createProgress({ enabled: json ? false : undefined });
    requireCredentials(flags.root);
    const { record, scanned } = await ensureRun({
      root: flags.root,
      runId: flags.run,
      force: flags.force,
      progress,
    });
    if (scanned) progress.done(formatScanSummary(record));

    const view = await runIntent({
      root: flags.root,
      runId: flags.run,
      path: flags.path,
      intent: query.join(" "),
      limit: flags.limit,
      budget: flags.budget,
      minConfidence: flags.minConfidence,
      progress,
    });
    console.log(
      json
        ? JSON.stringify(withContract(projectFields(view, flags.fields)), null, 2)
        : formatIntent(view, tableOptions()),
    );
  });

program.exitOverride();
for (const command of program.commands) command.exitOverride();

try {
  await program.parseAsync(withDefaultCommand(process.argv));
} catch (error) {
  exitWith(error);
}

function exitWith(error: unknown): void {
  if (error instanceof CommanderError) {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
      process.exitCode = 0;
      return;
    }
    process.exitCode = 2;
    return;
  }

  const failure = classifyError(error);
  if (wantsJson(process.argv.includes("--json"))) {
    console.error(
      JSON.stringify({ contract: CONTRACT_VERSION, ...errorEnvelope(failure) }, null, 2),
    );
  } else {
    console.error(failure.hint ? `${failure.message}\n${failure.hint}` : failure.message);
  }
  process.exitCode = failure.exitCode;
}

function withContract(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? { contract: CONTRACT_VERSION, ...value }
    : value;
}

function projectFields(view: IntentView, fields: string | undefined): unknown {
  if (!fields) return view;
  const keys = fields
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const opportunities = view.opportunities.map((opportunity) => {
    const record = opportunity as unknown as Record<string, unknown>;
    return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
  });
  return { ...view, opportunities };
}

function wantsJson(flag: boolean): boolean {
  return flag || process.stdout.isTTY !== true;
}

function tableOptions(): { color: boolean; width?: number } {
  return {
    color: process.stdout.isTTY === true,
    width: process.stdout.columns || undefined,
  };
}
