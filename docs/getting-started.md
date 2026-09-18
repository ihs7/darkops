# Getting started

## Install

```bash
npm install -g darkops
# or run from source:
bun install && bun run build
```

## Configure

darkops requires a TypeSafe API key from [typesafe.ai](https://typesafe.ai). The key powers Jev's judgments and intent-directed navigation; `run` and `mcp` exit with an auth error without one.

Store the key once in your user config so that every repository and shell can use it:

```bash
darkops auth --key ...
```

`darkops auth` never prompts, so it is safe in scripts: pass `--key`, or pipe the key on stdin (`printf '%s' "$TYPESAFE_API_KEY" | darkops auth`). It writes to `~/.config/darkops/.env` with `0600` permissions. Run `darkops auth --show` to confirm which source is in use.

In CI and workflow runners, set the key as a secret in the environment instead:

```yaml
- run: npx darkops "improve maintainability"
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

darkops resolves the key from the environment first, then a repository `./.env`, then the user config, so a shell export or a CI secret always wins. You can also put the key in `./.env` for a single project, or point `DARKOPS_CONFIG_DIR` at a different directory (useful for per-identity setups).

You can pin a model version instead of using the `jev-latest` alias. Pinning keeps a tuned configuration from shifting when the alias moves.

```bash
export TYPESAFE_DEFAULT_MODEL=jev-1.13.0
```

## Ask a question

There is no setup step. The first query scans the repository, compiles the map, and searches it, then prints a ranked list of opportunities.

```bash
darkops "improve maintainability"
```

```
darkops query · 5 found · jev-1.13.0
  query  improve maintainability

   rel  rconf  prio  conf  fan  chg  cplx  file                             drivers
  ────  ─────  ────  ────  ───  ───  ────  ───────────────────────────────  ─────────────────────────────────────
  0.61   0.57  33.7  0.48  4/0  1/0     3  src/state/store.ts               criticality, blast_radius (uncertain)
  0.55   0.48  42.1  0.50  1/8  1/0     5  src/commands/scan.ts             criticality, churn
  0.53   0.39  43.5  0.72  2/0  1/0    13  src/harness/complexity.ts        complexity, criticality
  0.53   0.38  47.8  0.75  2/0  1/0     8  src/mcp/server.ts                criticality, complexity
  0.52   0.38  35.2  0.71  1/0  1/0     8  src/harness/history/coupling.ts  complexity, churn

10 steps · 9,227 in / 1,289 out · ~$0.00039
```

Columns are right-aligned. `rel` and `rconf` are the relevance score and Jev's confidence in it; `prio` and `conf` are the file's maintainability priority and confidence, with `(uncertain)` marking a confidence below `0.5`; `chg` is churn and fix count. The table shrinks `file` and `drivers` and drops lower-value columns to fit your terminal.

The search skips uninformative levels and collects a shortlist, then Jev scores each file's **relevance** to the query. Relevance is independent of the file's intrinsic priority, so different questions return different files from the same repository. `--limit` caps the number of rows and defaults to roughly 5% of the files in scope, with a floor of 5 and a cap of 50. `--json` includes each result's reasoning trail. Later queries reuse the run and pick up file changes automatically.

## Tune the search

```bash
darkops "harden authentication" --limit 10      # more results
darkops "harden authentication" --budget 20     # explore further
darkops "harden authentication" --path src      # scope to an area
```

## Check cost

```bash
darkops usage
```

## Next

- [Commands](commands.md) for every flag.
- [Tools and the MCP server](tools.md) to serve evidence to agents.
- [Use cases](use-cases.md) for scenarios.
- [Limitations](limitations.md) before relying on darkops in a pipeline.
