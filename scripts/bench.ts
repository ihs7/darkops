import { join } from "node:path";
import { runScan } from "../src/commands/scan";
import { formatEconomics } from "../src/eval/format";
import { BENCHMARK_QUERIES } from "../src/eval/queries";
import {
  buildCostFromUsage,
  summarize,
  type EconomicsReport,
  type QueryCost,
} from "../src/eval/report";
import { runIntent } from "../src/map/intent";
import { ensureState, stateDir, writeJson } from "../src/state/store";

interface BenchFlags {
  root: string;
  limit: number;
  json: boolean;
  cold: boolean;
  queries: string[];
}

const flags = parse(Bun.argv.slice(2));
const startedAt = new Date().toISOString();
await ensureState(flags.root);

let cold: EconomicsReport["cold"] = null;
if (flags.cold) {
  const begin = Date.now();
  const record = await runScan({
    root: flags.root,
    concurrency: 8,
    maxBytes: 65536,
    force: true,
  });
  cold = buildCostFromUsage(record.usage, Date.now() - begin);
}

const warmBegin = Date.now();
const warmRecord = await runScan({
  root: flags.root,
  concurrency: 8,
  maxBytes: 65536,
  force: false,
});
const warm = buildCostFromUsage(warmRecord.usage, Date.now() - warmBegin);

const queries: QueryCost[] = [];
for (const intent of flags.queries) {
  const begin = Date.now();
  const view = await runIntent({
    root: flags.root,
    intent,
    limit: flags.limit,
    model: warmRecord.model,
    fresh: true,
  });
  queries.push({
    intent,
    inputTokens: view.usage.inputTokens,
    outputTokens: view.usage.outputTokens,
    steps: view.steps,
    stop: view.stop,
    elapsedMs: Date.now() - begin,
  });
}

const report: EconomicsReport = {
  root: flags.root,
  model: warmRecord.model,
  startedAt,
  cold,
  warm,
  queries,
};
const summary = summarize(report);
const out = join(stateDir(flags.root), "bench", `${startedAt.replace(/[:.]/g, "-")}.json`);
await writeJson(out, { report, summary });

if (flags.json) {
  console.log(JSON.stringify({ report, summary, out }, null, 2));
} else {
  console.log(formatEconomics(report, summary));
  console.log(`\nsaved ${out}`);
}

function parse(args: string[]): BenchFlags {
  const parsed: BenchFlags = {
    root: process.cwd(),
    limit: 5,
    json: false,
    cold: true,
    queries: [...BENCHMARK_QUERIES],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      parsed.root = args[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = Number.parseInt(args[index + 1] ?? "", 10) || parsed.limit;
      index += 1;
    } else if (arg === "--queries") {
      const value = args[index + 1] ?? "";
      const list = value
        .split("|")
        .map((intent) => intent.trim())
        .filter((intent) => intent.length > 0);
      if (list.length > 0) parsed.queries = list;
      index += 1;
    } else if (arg === "--no-cold") {
      parsed.cold = false;
    } else if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}
