import { createDispatcher } from "../jev/dispatcher";
import { runIntent } from "../map/intent";
import { buildMap } from "../map/tree";
import { serveStdio } from "../mcp/server";
import { formatIntent } from "../report/format";
import { VERSION } from "../report/manifest";
import { createInvestigateTool, createNavigateTool } from "../tools/intent";
import { buildCatalog, buildTools } from "../tools/registry";
import { ensureRun } from "./ensure";

export interface McpOptions {
  root: string;
  runId?: string;
  name?: string;
}

export async function runMcp(options: McpOptions): Promise<void> {
  const { record } = await ensureRun({
    root: options.root,
    runId: options.runId,
  });
  const tree = buildMap(record);
  const catalog = buildCatalog(record, tree);
  const evidence = buildTools({ record, tree }, catalog);

  const navigateTool = createNavigateTool(async (intent, path, runId) => {
    const target = runId ?? options.runId;
    if (!target) await ensureRun({ root: options.root });
    const view = await runIntent({
      root: options.root,
      runId: target,
      intent,
      path,
      model: record.model,
      limit: 3,
    });
    return { content: formatIntent(view), data: view };
  }, catalog.areas);

  const routable = [...evidence, navigateTool];
  const dispatcher = createDispatcher({ model: record.model });
  const investigate = createInvestigateTool(async (intent) => {
    const { call } = await dispatcher.dispatch(intent, routable);
    if (!call) return { content: "No tool fits the intent.", data: null };

    const tool = routable.find((entry) => entry.name === call.name);
    if (!tool) return { content: `No tool named ${call.name}.`, data: null };

    const args = call.name === "navigate" ? { ...call.arguments, intent } : call.arguments;
    return tool.run(args);
  });

  await serveStdio({
    name: options.name ?? "darkops",
    version: VERSION,
    tools: [...evidence, navigateTool, investigate],
  });
}
