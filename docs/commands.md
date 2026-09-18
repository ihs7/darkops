# Commands

darkops has four explicit commands (`auth`, `usage`, `mcp`, and `schema`) plus a default command that takes a query. There is no separate scan step: the wide pass runs automatically when needed and updates itself when the tree changes.

All commands take `-r, --root <dir>` (default: the current directory). Human output goes to stdout; errors and scan progress go to stderr. Exit codes are listed under [Machine contract](#machine-contract).

When stderr is a terminal, the wide pass and the search draw a live line in place showing units reviewed, Jev calls, cache hits, failures, input tokens, elapsed time, and the current file. The line is disabled automatically when output is piped, under `--json`, or in MCP mode. Set `DARKOPS_NO_PROGRESS=1` to turn it off on a terminal.

## `<query>` (default command)

```bash
darkops "improve maintainability"
darkops where is the harness hardest to change safely
```

A bare query searches the compiled map and returns a ranked list of opportunities. The map is flattened into an index once. At each step the search gives Jev a _neighborhood_: the immediate children plus the highest-priority deeper descendants within a small lookahead. This lets the search jump past uninformative levels instead of descending one directory at a time. Code owns the frontier. Jev scores the options, code descends into the best one, records leaves as opportunities, and when a branch is exhausted pops the next-best node and continues. The search stops when it reaches the budget or the frontier is empty. Each expansion costs one small Jev judgment.

If no run exists, or the tree changed since the last run, darkops scans the repository first. Only changed units cost tokens, and a query against an unchanged repository makes no model calls.

| Flag               | Default        | Purpose                                             |
| ------------------ | -------------- | --------------------------------------------------- |
| `-l, --limit`      | scales (min 5) | Maximum opportunities to return.                    |
| `--budget`         | 12             | Maximum Jev judgments (expansions).                 |
| `--min-confidence` | 0.2            | Prune a branch when a judgment falls below this.    |
| `-p, --path`       | root           | Scope the search to an area.                        |
| `--force`          | false          | Rebuild the map from scratch.                       |
| `--run <id>`       | latest         | Use a specific run.                                 |
| `--json`           | TTY? no        | Print the opportunities and trails as JSON.         |
| `--fields <list>`  | all            | Project opportunity fields (e.g. `path,relevance`). |

`--limit` defaults to about 5% of the files in scope, with a floor of 5 and a cap of 50, so a large repository returns a larger list by default. When you scope the search with `--path`, the percentage is taken over the files under that area.

## `auth`

Store the TypeSafe API key in the user config file.

| Flag          | Default | Purpose                                                    |
| ------------- | ------- | ---------------------------------------------------------- |
| `--key <key>` | stdin   | API key to save; when omitted, the key is read from stdin. |
| `--show`      | false   | Print which source the key resolves from, without saving.  |

`auth` never prompts, so agents, scripts, and CI can run it without a TTY. It writes `$XDG_CONFIG_HOME/darkops/.env` (default `~/.config/darkops/.env`) with `0600` permissions, creating the directory if needed, and preserves other variables already in the file. Set `DARKOPS_CONFIG_DIR` to write somewhere else.

On a shared machine, prefer stdin over `--key`: a flag is visible in shell history and the process list.

## `schema`

Print the versioned CLI contract as JSON: the `contract` version, the scanned `languages` (extensions), every command and its flags, the recognized environment variables, and the exit codes. Use it to discover the surface without scraping `--help`.

## Machine contract

- JSON is the default whenever stdout is not a TTY, and always available with `--json`. Every JSON payload carries a top-level `contract` version.
- Failures are a structured envelope: `{ "contract": 1, "error": { "code", "message", "hint"? } }`.
- Exit codes are branchable: `0` success, `2` usage, `3` auth, `4` missing run, `5` API error, `1` internal.
- `--fields path,relevance` projects the opportunity objects in JSON output.

## Requires a key

`run` and `mcp` require a TypeSafe API key. Without one they exit with an `AUTH` error (exit code `3`) and a hint to run `darkops auth`. `auth`, `usage`, and `schema` work without a key, so you can inspect the contract and set up credentials before the first query.

## `usage`

Token usage and estimated cost across runs.

| Flag          | Default | Purpose            |
| ------------- | ------- | ------------------ |
| `-l, --limit` | 10      | Runs to print.     |
| `--json`      | false   | Print totals+rows. |

## `mcp`

Serve the read-only evidence tools over MCP on stdio (tools-only: `initialize`, `tools/list`, `tools/call`). Scans first if no run exists.

| Flag         | Default | Purpose             |
| ------------ | ------- | ------------------- |
| `--run <id>` | latest  | Use a specific run. |
| `--name`     | darkops | Server name.        |

## Relevance and drivers

Each result leads with a **relevance** score from `0.00` to `1.00` for your query. Jev assigns it after the search collects the shortlist, judging how likely each file is the one the intent refers to. Relevance is independent of the file's intrinsic priority. Because the walk is budgeted, every area also contributes its hottest file to the shortlist, so a directory is never silently ignored; `--budget` allows more exploration. `--limit` caps how many results print and defaults to about 5% of the files in scope (floor 5, cap 50); fewer rows appear when fewer files clear the relevance filter. The remaining columns are computed evidence:

- `rel` / `rconf`: relevance to the query and Jev's confidence in it.
- `prio` / `conf`: the file's maintainability priority and Jev's confidence in it. `(uncertain)` next to `drivers` means that maintainability confidence is below `0.5`.
- `fan`: fan-in / fan-out (dependents / imports).
- `chg`: recent commits / bug-fix commits; `cplx`: maximum cyclomatic complexity.
- `drivers`: `criticality`, `blast_radius`, `change_risk`, `low_cohesion`, `churn`, `defect_history`, `complexity`.

## State

State is stored centrally, not per-repository, so clones and checkouts stay clean. It lives under `~/.darkops/repos/<name>-<hash>/`, where `<hash>` is derived from the absolute repository path, so two checkouts get separate state:

- `runs/<id>/scan.json`: a full run record.
- `latest.json`: pointer to the latest run.
- `cache.json`: judgment cache, keyed by `CACHE_VERSION`, content hash, model, and a full state fingerprint.
- `nav-cache.json`: cached navigation judgments.

Override the base with `DARKOPS_HOME` (default `~/.darkops`), or point a single run at an exact directory with `DARKOPS_STATE_DIR` (sets a repo-local `.darkops/`, for tests, CI, or keeping state on a different disk). `rm -rf ~/.darkops` clears everything.

## Environment

`TYPESAFE_API_KEY` is required for `run` and `mcp`. It resolves from the first source that has it; the other variables below resolve in the same order:

1. the process environment (CI secrets, `op run`, `direnv`, an exported variable),
2. `./.env` in the repository root,
3. `$XDG_CONFIG_HOME/darkops/.env` (default `~/.config/darkops/.env`), written by `darkops auth`.

`DARKOPS_CONFIG_DIR` overrides the user config directory. Run `darkops auth --show` to see the active source.

- `TYPESAFE_DEFAULT_MODEL` (optional; defaults to the `jev-latest` alias). Pin a version to keep tuned thresholds stable when the alias moves.
