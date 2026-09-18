# darkops

<p align="center">
  <img src=".github/assets/logo.png" alt="darkops" width="160">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/darkops"><img src="https://img.shields.io/npm/v/darkops.svg" alt="npm version"></a>
  <a href="https://github.com/ihs7/darkops"><img src="https://img.shields.io/npm/l/darkops.svg" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js 20 or later">
</p>

A repository-scale maintainability map for software factories, powered by [Jev](https://typesafe.ai). darkops scans a repository once, builds a searchable map of its code, and answers a query with a ranked list of the files most worth attention, together with the evidence behind each ranking.

It is read-only. It does not edit code, run tests, or plan work. It returns judgment for a person or an agent to act on.

## Why install darkops

You cannot paste a real repository into a chat window. A 5,000-file repo is too large, and the workaround, chunking and retrieving, is a system you would have to build and maintain. darkops is that system, for one job: deciding where attention should go.

- **Answers are fast, cheap, and always current.** There is no scan step to run: the first question builds the map, and later questions reflect whatever changed in the repository. Asking again costs nothing, while an LLM re-reads its context every time.
- **It knows your structure.** Dependents, coupling, churn, bug fixes, and complexity are computed from the repository, not guessed. Ask an LLM what depends on a file and it will guess or admit it cannot see it.
- **It answers your intent, not a fixed list.** A generic hotspot ranking returns the same files every time. A query searches the map against the objective and returns the files that matter for that question, each with a reasoning trail.
- **It is reproducible.** The same repository gives the same map, so you can budget it, diff it over time, and trust it in CI.
- **It is built for agents.** One read-only map, served over MCP, shared by a fleet instead of each agent exploring the tree on its own.

darkops is not the model; it is what tells the model, or you, where to look. If the repository is small, the question is one-off, and you are already in an agent with the file open, just ask the agent. darkops earns its place as repositories, repetition, and automation grow.

## Install

```bash
npm install -g darkops
```

Or run it without installing:

```bash
npx darkops "improve maintainability"
```

Requires Node.js 20 or later and a TypeSafe API key.

## Quick start

```bash
npx darkops auth --key ...             # store the TypeSafe API key once (https://typesafe.ai)
npx darkops "improve maintainability"  # scan the repository, then search the map
npx darkops mcp                        # serve the evidence tools to an agent
```

In CI or a workflow, set `TYPESAFE_API_KEY` as a secret instead of running `auth`. A key is required: `run` and `mcp` exit with an auth error when none is found. There is no separate scan step, since the first query builds the map and later queries repair it automatically when files change.

## Commands

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `darkops "<query>"` | Search the map; ranked list of opportunities (the default).    |
| `darkops auth`      | Store the TypeSafe API key in the user config file.            |
| `darkops usage`     | Jev token usage and estimated cost across runs.                |
| `darkops mcp`       | Serve the read-only tools over MCP on stdio.                   |
| `darkops schema`    | Print the versioned machine contract (commands, flags, exits). |

Query flags: `--limit`, `--budget`, `--min-confidence`, `--path`, `--run`, `--force`, `--json`, and `--fields`. Later queries pick up file changes automatically; `--force` is the only escape hatch, and it rebuilds the map from scratch.

## How it works

1. **Wide pass.** darkops discovers source units (git-aware), collects evidence (import graph, git history, complexity), asks Jev a small set of typed questions about each unit, and combines the answers with deterministic weights into a ranked run. This runs on the first query, and later runs pay only for what changed.
2. **Map.** Code aggregates the run into a tree of areas and compiles it into a flat index.
3. **Search.** A query is answered by a bounded search over the map. Jev scores a neighborhood (children plus deeper descendants, so the search can skip levels), code walks a frontier and backtracks, and the result is a ranked list of opportunities with a trail for each.
4. **MCP.** The same harness serves its read-only evidence tools to external agents.

Jev returns typed judgments with calibrated confidence. Every weight, threshold, and consequence stays in code.

## Use cases

- **Orient in a large or unfamiliar repository.** A single command compiles the map and returns a ranked list, instead of an agent spending its context working out where things live.
- **Focus attention on an objective.** Ask `darkops "reduce blast radius around billing"` and get the files that matter for that intent, each with a reasoning trail.
- **Let an agent pull evidence on demand.** Expose the read-only tools over MCP and an agent can request dependents, coupling, or history for a unit it is already looking at.
- **Keep a repeatable, low-cost view.** The map refreshes automatically, so a follow-up run pays only for what changed.

See [`docs/use-cases.md`](docs/use-cases.md) for examples.

## What darkops is not

darkops does not decide what to build, edit code, open pull requests, run tests, or schedule work. Those belong to the caller or the surrounding factory. It supplies the map; the caller chooses the route.

## Languages

Discovery and the import graph cover TypeScript/JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), Python (`.py`), Go (`.go`), and Rust (`.rs`). The TypeScript path is AST-quality. The others are lexical adapters with their own resolution rules: Python packages and relative imports, Go modules via `go.mod`, and Rust `crate`/`super`/`self`/`mod`. Everything above the harness (history, coupling, the map, navigation, the fleet tools) is language-agnostic. `darkops schema` lists the exact extensions.

## Cost

Only Jev input tokens are billed, at $0.042 per million tokens for `jev-1.13.0`; output is free. A scan sends each source unit once, and unchanged units are never sent again. A repeated query costs nothing, and a new query adds one small judgment per expansion, bounded by `--budget`. `darkops usage` reports totals.

## Documentation

Full documentation lives in [`docs/`](docs/):

- [Getting started](docs/getting-started.md)
- [Commands](docs/commands.md)
- [Tools and the MCP server](docs/tools.md)
- [Use cases](docs/use-cases.md)
- [Limitations](docs/limitations.md)

## Environment

- `TYPESAFE_API_KEY` (required). Resolved from the environment, then `./.env`, then `~/.config/darkops/.env` (`$XDG_CONFIG_HOME/darkops/.env`; override the directory with `DARKOPS_CONFIG_DIR`). `darkops auth` writes the last one. Run `darkops auth --show` to see which source is in use. `run` and `mcp` exit with an auth error when it is missing.
- `DARKOPS_HOME` (optional; default `~/.darkops`). Base directory for runs and their stored state, namespaced per repository. `DARKOPS_STATE_DIR` overrides the exact directory, for example a repo-local `.darkops/`.
- `TYPESAFE_DEFAULT_MODEL` (optional; defaults to the `jev-latest` alias). Pin a version when tuning.
- `DARKOPS_NO_PROGRESS` (optional). Set it to suppress the live progress line.
- `NO_COLOR` (optional). Keep the progress line but drop the color.

## Development

```bash
bun install
bun run dev "improve maintainability"   # run the CLI from source
bun run check                           # oxfmt --check + oxlint
bun run typecheck
bun test
bun run build                           # emits dist/cli.js (Node-compatible)
```

## Contributing

Issues and pull requests are welcome. Open pull requests as drafts. Before submitting, run `bun run fmt`, `bun run check`, `bun run typecheck`, and `bun test`.

## License

MIT
