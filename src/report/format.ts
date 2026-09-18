import type { UsageRow, UsageTotals } from "../commands/usage";
import type { IntentOpportunity, IntentView } from "../map/intent";
import { estimateCost, formatTokens, formatUsd } from "../jev/pricing";
import type { RunRecord, RunUnit } from "../state/store";
import { renderTable, type TableColumn, type TableOptions } from "./table";
import type { Tone } from "./style";

const INTENT_COLUMNS: TableColumn<IntentOpportunity>[] = [
  { header: "rel", align: "right", value: (row) => row.relevance.toFixed(2), tone: relevanceTone },
  {
    header: "rconf",
    align: "right",
    value: (row) => row.relevanceConfidence.toFixed(2),
    drop: 6,
  },
  { header: "prio", align: "right", value: (row) => row.priority.toFixed(1), drop: 5 },
  { header: "conf", align: "right", value: (row) => row.confidence.toFixed(2), drop: 4 },
  {
    header: "fan",
    align: "right",
    value: (row) => `${row.stats.fanIn}/${row.stats.fanOut}`,
    drop: 3,
  },
  {
    header: "chg",
    align: "right",
    value: (row) => `${row.stats.churn}/${row.stats.defect}`,
    drop: 2,
  },
  { header: "cplx", align: "right", value: (row) => String(row.stats.complexity), drop: 1 },
  {
    header: "file",
    value: (row) => row.path,
    truncate: "path",
    shrink: true,
    minWidth: 12,
  },
  {
    header: "drivers",
    value: driversText,
    tone: () => "dim",
    truncate: "end",
    shrink: true,
    grow: true,
    minWidth: 10,
    drop: 7,
  },
];

const USAGE_COLUMNS: TableColumn<UsageRow>[] = [
  { header: "run", value: (row) => row.id, shrink: true, minWidth: 10 },
  { header: "started", value: (row) => row.startedAt, shrink: true, minWidth: 10, drop: 1 },
  { header: "calls", align: "right", value: (row) => String(row.calls) },
  { header: "cached", align: "right", value: (row) => String(row.cached) },
  { header: "in", align: "right", value: (row) => formatTokens(row.inputTokens) },
  { header: "out", align: "right", value: (row) => formatTokens(row.outputTokens) },
  { header: "cost", align: "right", value: (row) => formatUsd(row.costUsd) },
];

const SCAN_COLUMNS: TableColumn<RunUnit>[] = [
  { header: "score", align: "right", value: (row) => row.priority.toFixed(1) },
  { header: "file", value: (row) => row.relPath, truncate: "path", shrink: true, minWidth: 12 },
  {
    header: "drivers",
    value: (row) =>
      `${row.drivers.join(", ") || "no dominant driver"}${
        row.uncertain.length > 0 ? ` (uncertain: ${row.uncertain.join(", ")})` : ""
      }`,
    tone: () => "dim",
    truncate: "end",
    shrink: true,
    grow: true,
    minWidth: 10,
  },
];

export function formatScan(record: RunRecord, limit: number, options: TableOptions = {}): string {
  const ranked = record.units
    .filter((unit) => !unit.error)
    .sort((a, b) => b.priority - a.priority || a.relPath.localeCompare(b.relPath));

  const lines = [
    `darkops scan · ${record.counts.total} units · discovery ${record.mode} · ${record.model}`,
    "",
    renderTable(SCAN_COLUMNS, ranked.slice(0, limit), options),
    "",
    scanTotals(record),
  ];
  return lines.join("\n");
}

export function formatScanSummary(record: RunRecord): string {
  const { usage, counts } = record;
  const cost = estimateCost(usage, record.model);
  return (
    `scanned ${counts.total} units · ${usage.calls} calls (${usage.cached} cached, ` +
    `${usage.failed} failed) · ${formatTokens(usage.inputTokens)} in · ~${formatUsd(cost)}`
  );
}

export function formatUsage(
  rows: UsageRow[],
  totals: UsageTotals,
  limit: number,
  options: TableOptions = {},
): string {
  const lines = [
    `darkops usage · ${totals.runs} runs · ${formatTokens(totals.inputTokens)} in · ~${formatUsd(
      totals.costUsd,
    )}`,
    "",
    renderTable(USAGE_COLUMNS, rows.slice(0, limit), options),
    "",
    `total · ${totals.runs} runs · ${totals.calls} calls (${totals.cached} cached) · ` +
      `${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out · ` +
      `~${formatUsd(totals.costUsd)}`,
  ];
  return lines.join("\n");
}

export function formatIntent(view: IntentView, options: TableOptions = {}): string {
  const lines = [
    `darkops query · ${view.opportunities.length} found · ${view.model}`,
    `  query  ${view.intent}`,
    "",
  ];

  if (view.opportunities.length === 0) {
    lines.push("  no relevant files found");
  } else {
    lines.push(renderTable(INTENT_COLUMNS, view.opportunities, { indent: "  ", ...options }));
  }

  const { usage } = view;
  lines.push("");
  lines.push(
    `${view.steps} steps · ${formatTokens(usage.inputTokens)} in / ${formatTokens(
      usage.outputTokens,
    )} out · ~${formatUsd(estimateCost(usage, view.model))}`,
  );

  return lines.join("\n");
}

function scanTotals(record: RunRecord): string {
  const { usage, counts } = record;
  return (
    `${counts.scored} scored · ${counts.failed} failed · skipped ${counts.skipped} · ` +
    `${usage.calls} calls (${usage.cached} cached, ${usage.failed} failed) · ` +
    `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out · ` +
    `~${formatUsd(estimateCost(usage, record.model))}`
  );
}

function driversText(opportunity: IntentOpportunity): string {
  const base = opportunity.drivers.join(", ") || "no dominant driver";
  return opportunity.confidence < 0.5 ? `${base} (uncertain)` : base;
}

function relevanceTone(opportunity: IntentOpportunity): Tone {
  if (opportunity.relevance >= 0.7) return "green";
  if (opportunity.relevance >= 0.45) return "yellow";
  return "dim";
}
