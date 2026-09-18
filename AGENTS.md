# AGENTS.md

Guidance for agents working in this repository.

## Commands

```bash
bun run dev "improve maintainability"   # run the CLI from source
bun run check                           # oxfmt --check + oxlint
bun run lint:fix                        # oxlint --fix
bun run fmt                             # oxfmt --write
bun run typecheck                       # tsc --noEmit
bun test                                # bun:test
bun run build                           # dist/cli.js (Node target)
```

## Architecture

- `src/harness/*`: evidence collectors over the target repo. `discover` finds git-aware file units, `graph` builds import edges, `history` covers churn, ownership, bug fixes, and change coupling, and `complexity` computes AST metrics. `src/harness/languages/*` holds the per-language adapters.
- `src/jev/*`: `questions` (the investigation pack), `client` (SDK wrapper and state shape), `navigator` (Jev ranker and relevance scorer), `dispatcher` (Jev function-calling for tools), `policy` (weights, drivers, percentiles), and `pricing`.
- `src/map/*`: `tree` (hierarchical aggregation of a run), `compile` (flat searchable index), `search` (budgeted walk, area coverage, relevance scoring), `scope` (result count, area scope, per-unit stats), and `intent` (search orchestration over a run).
- `src/tools/*`: `registry` (read-only evidence tools in MCP shape), `intent` (`navigate` and `investigate` tool definitions), and `fleet` (attention tools such as `work_list`, `change_impact`, and `safe_lanes`).
- `src/mcp/server.ts`: minimal tools-only MCP stdio server.
- `src/commands/*`: `ensure` (auto-scan when a run is missing), `scan` (wide pass), `auth`, `usage`, `mcp`, and `units` (unit assembly and computed signals). `schema` is registered inline in `src/cli.ts`.
- `src/state/*`: run records, the central state path, the judgment cache key and fingerprints, and the navigation cache.
- `src/eval/*`: the economics benchmark (cold and warm scan cost, per-query tokens).
- `src/report/*`: terminal output, progress, tables, and the CLI manifest.
- `src/util/*`: argument routing, credentials, errors, and the concurrency pool.

## Invariants

- **Jev judges; code computes.** Never ask Jev for anything derivable: counts, dates, sizes, arithmetic. Those are computed in `src/harness/*` and passed as state.
- **All scoring lives in `src/jev/policy.ts`.** Changing weights, drivers, or factors takes effect on the next scan without new inference.
- **Ask all needed questions in one call.** Jev evaluates every question against the shared state in parallel. A second request is only warranted when an earlier answer is needed to build the next state. Keep each question one narrow judgment, and word instructions literally.
- **The judgment cache key carries `CACHE_VERSION`, content hash, model, and a full state fingerprint** (`stateFingerprint` in `src/state/store.ts`): graph, history (commits, bug fixes, authorship, coupling), and complexity, which is everything Jev sees beyond content. Policy (weights, drivers) is applied when scoring, so tuning it never triggers new Jev calls. A question-pack or state-shape change bumps `CACHE_VERSION`. The cache is pruned to the keys the latest run referenced.
- **State is central, never written into the scanned repository.** Runs and caches live under `~/.darkops/repos/<name>-<hash>/` (`DARKOPS_HOME` base, `DARKOPS_STATE_DIR` exact-dir override). Anything that derives the state path must go through `stateDir(root)` so tests can isolate it.
- **Freshness is automatic.** A run records a repository fingerprint; `ensureRun` compares it against a fresh discovery and rescans only when the tree moved, paying only for changed units. Do not reintroduce a "remember to pass `--refresh`" requirement.
- **Navigation judgments are cached too** (`src/state/nav-cache.ts`), keyed by model, intent, and the exact candidate/neighborhood payload. A repeated or overlapping query makes no Jev calls, and the key changes when anything Jev saw changes.
- **Jev is required.** `run` and `mcp` resolve the key with `requireCredentials` and exit with an `AUTH` error (code 3) when none is found; `auth`, `usage`, and `schema` run without one. There is no keyless scoring path.
- **Confidence is Jev-only.** Computed signals never affect confidence.
- **Navigation reuses the run's model.** Intent navigation defaults to the model recorded in the run, so map scores and navigation judgments agree.
- **Tools are read-only.** Jev-dispatched evidence arguments are closed sets that code validates before executing. The intent tools (`navigate`, `investigate`) take the caller's free-form objective. Never add a tool that mutates the repository.
- **Secrets never reach the repo.** `TYPESAFE_API_KEY` resolves from the environment, then a gitignored repo `.env`, then the user config (`~/.config/darkops/.env`, `DARKOPS_CONFIG_DIR` overrides). `darkops auth` writes the user config. Keep the resolution order in `src/util/credentials.ts` authoritative, and do not log the key or commit it.

## Adding an evidence source

1. Add `src/harness/<name>.ts` returning per-unit facts. Keep it deterministic and offline.
2. Wire it into `src/commands/scan.ts` and pass it into the Jev state (in `src/jev/client.ts`).
3. If it should affect ranking, add a computed signal to `policy.ts` (percentile-normalized).
4. Add the field to `RunUnit` and surface it in `map`. If it changes what Jev is asked (the state or question pack), bump `CACHE_VERSION` so cached answers invalidate. Never rely on a manual cache wipe.
5. Add a test using a temp directory. Tests must not call the Jev API.

## Adding a language

1. Add `src/harness/languages/<name>.ts` exporting a `LanguageSupport` (extensions, `isTest`, `isDeclaration`, `extractModuleFacts`, `resolveSpecifiers`, `analyzeComplexity`). Reuse `scan.ts` helpers when the shape matches.
2. Register it in `src/harness/languages/index.ts`. `knownExtensions()` feeds `schema`.
3. Test offline in `tests/languages.test.ts`: import extraction, specifier resolution with the language's package and module conventions, and a complexity sanity check.
4. Precision over recall: if resolution would guess, return no target rather than a wrong edge. A poisoned import graph corrupts blast radius and navigation.
5. Only TypeScript has type-only imports and exports; other adapters leave `typeImports` and `typeExports` empty.

## Style

- No comments. Prefer self-explanatory names.
- Keep files under about 300 lines, and use feature folders.
- `oxfmt` and `oxlint` are enforced by `bun run check`. Run `bun run fmt` before committing.
- Tests use `bun:test` and never hit the network. Tests that shell out to git must use `tests/support/git.ts`, which isolates git config so a contributor's global settings (for example `commit.gpgsign`) cannot affect a fixture.

## Pull requests

Open pull requests as drafts.
