import { estimateCost, formatTokens, formatUsd } from "../jev/pricing";
import type { BuildCost, EconomicsReport, EconomicsSummary } from "./report";

export function formatEconomics(report: EconomicsReport, summary: EconomicsSummary): string {
  const lines = [`benchmark ${report.root}`, `model     ${report.model}`];

  if (report.cold) {
    lines.push(buildLine("cold build", report.cold, report.model));
  }
  if (report.warm) {
    lines.push(buildLine("warm build", report.warm, report.model));
  }

  const queryUsage = { inputTokens: summary.queryInputTokens, outputTokens: 0 };
  lines.push(
    `  ${"queries".padEnd(11)} ${formatTokens(summary.queryInputTokens).padStart(12)} tokens  ` +
      `${formatUsd(estimateCost(queryUsage, report.model))}  ` +
      `mean ${formatTokens(Math.round(summary.queryMeanTokens))} · ` +
      `median ${formatTokens(Math.round(summary.queryMedianTokens))} · n ${report.queries.length}`,
  );
  lines.push(
    `  ${"total".padEnd(11)} ${formatTokens(summary.totalInputTokens).padStart(12)} tokens  ` +
      `${formatUsd(summary.totalCostUsd)}`,
  );

  return lines.join("\n");
}

function buildLine(label: string, cost: BuildCost, model: string): string {
  const usage = { inputTokens: cost.inputTokens, outputTokens: cost.outputTokens };
  return (
    `  ${label.padEnd(11)} ${formatTokens(cost.inputTokens).padStart(12)} tokens  ` +
    `${formatUsd(estimateCost(usage, model))}  ` +
    `${cost.calls} calls · ${cost.cached} cached · ${cost.failed} failed · ${cost.elapsedMs} ms`
  );
}
