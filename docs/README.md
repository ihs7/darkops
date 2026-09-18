# darkops docs

darkops is a repository-scale maintainability map. It scans a repository once, builds a hierarchical map of the code, and answers a query by pointing at the files most worth attention and explaining why.

darkops reads code and returns judgments. It does not edit files, run tests, plan work, or open pull requests.

## Start here

- [Getting started](getting-started.md): install, scan, and read the map.
- [Commands](commands.md): the full CLI reference.
- [Tools and the MCP server](tools.md): read-only evidence tools, Jev dispatch, and MCP.
- [Use cases](use-cases.md): scenarios and example runs.
- [Limitations](limitations.md): what darkops does not do yet.

## How it works

The first query triggers a **wide pass**. It scores every source unit using a small set of typed Jev questions together with deterministic evidence: the dependency graph, git history, and complexity. The answers are aggregated into a **map**, a tree of areas where each node carries its risk, its hottest file, and a hint for drilling down. A query then searches the map, skipping levels that carry no useful information and backtracking when a branch is exhausted, and returns a ranked list of opportunities.
