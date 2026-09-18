# Limitations

This page lists what darkops does not do today.

## Scope

- **Four language families, uneven depth.** Discovery and the import graph cover TypeScript/JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), Python (`.py`), Go (`.go`), and Rust (`.rs`). The TypeScript path is AST-quality, using Babel and `es-module-lexer`. The others are lexical adapters: imports, exports, and complexity come from the source text and each language's resolution conventions, so they are more approximate. Other languages are not scanned.
- **Source units are files.** Modules, packages, and symbols are not first-class units, and the dependency graph is file-level; there is no symbol-level graph or centrality measure. Go is the exception in the other direction: an import maps to every non-test file in the target package.
- **No coverage report for skipped languages.** A file in an unsupported language is not a candidate. The run records the `language` of every scanned unit but does not count what was skipped by extension.

## Signal quality

- **Boundary coherence is not computed.** Coupling that crosses a module boundary is a useful signal, but it is not part of scoring or hints yet.
- **Hotspot and change coupling are collected but not fused into scoring.** Change frequency and co-change data exist in the history output, but the ranking still treats churn, complexity, and coupling separately rather than combining them into a hotspot score.
- **Hints are shallow.** Map hints name the hottest member and its drivers. They do not point at a specific coupling or boundary violation.

## Performance and scale

- **Discovery is not incremental.** The graph, history, and complexity are rebuilt, and every file is re-hashed on each query to check freshness. Jev calls are free for unchanged units, since the judgment cache is content- and state-addressed and navigation has its own cache, but discovery and evidence collection still touch the whole tree. A git-commit or mtime check before re-hashing is the obvious next step.
- **The judgment cache is per-repository and bounded by a cap**, not by a run. Navigation entries are kept newest-first up to `NAV_CACHE_LIMIT`.

## Navigation

- **Greedy, branch-bounded.** Navigation follows a best-first frontier with backtracking, capped by `--budget` expansions and `--min-confidence`. It does not keep a wide beam.
- **Judge quality depends on the summary.** Child descriptions carry the path, size, score, and drivers. An area with little signal in its name can be hard for Jev to rank.

## Interoperability

- **MCP is tools-only.** `darkops mcp` exposes tools (`initialize`, `tools/list`, `tools/call`) but no resources, prompts, sampling, or authentication.
- **Evidence tools bind a run at startup.** `navigate` re-checks freshness on each call, but the evidence and fleet tools use the run that was loaded when the server started, so a long-running session can serve stale evidence until it is restarted. Dynamic run selection applies to `navigate` only.
- **The contract is versioned but young.** `contract: 1` is a starting point, and you should expect additive changes.

## Removed on purpose

- **Outcome tracking (`verify`).** Recording done/rejected would turn self-reported labels into a signal. Until verification can be grounded in executable evidence, it is not part of darkops.
- **Work selection (`next`) and planning.** Deciding and ordering work is out of scope; callers and factories own intent.
