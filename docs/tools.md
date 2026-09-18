# Tools and the MCP server

darkops exposes its evidence as a small set of read-only tools. They are defined once in the [MCP](https://modelcontextprotocol.io) shape (`name`, `description`, `inputSchema` as JSON Schema, and `annotations.readOnlyHint`). External agents call them through `darkops mcp`, and the harness uses the same definitions internally.

## Tools

| Tool              | Argument          | Returns                                                               |
| ----------------- | ----------------- | --------------------------------------------------------------------- |
| `describe_unit`   | `path`            | Full evidence bundle: priority, drivers, graph, history, complexity.  |
| `list_dependents` | `path`            | Files that import the unit.                                           |
| `list_coupling`   | `path`            | Files that change with the unit but are not imported.                 |
| `git_history`     | `path`            | Recent commits, bug fixes, reverts, authorship, last modified.        |
| `list_hotspots`   | `area` (optional) | Highest-priority units inside an area.                                |
| `investigate`     | `intent`          | Lets Jev choose and run one of the above (or navigate) for an intent. |

Evidence-tool arguments are closed sets derived from the latest run, so the model can only choose a value the tool accepts; code never trusts a free-form argument. Candidates are capped at the top 40 units (or areas) by priority.

## Navigation is an internal tool

`navigate` is not exposed as its own CLI command. It is a tool the harness owns:

- `darkops "<query>"` runs the search directly and prints the ranked list of opportunities.
- `investigate` can route to it when an intent is about _where_ to look rather than _what_ evidence to fetch.

## Letting Jev pick the tool

`investigate` is the harness's function-calling path. Jev answers one batched request: a Choice over the tool descriptions, plus a Choice per closed-set argument and a yes/no for each optional argument. Code reads only the chosen tool's answers, validates them against the closed set, and runs the tool. Confidence is the least certain judgment behind the call. This is the TypeSafe function-calling pattern: Jev selects, it does not generate free-form arguments.

## `mcp`: serve the tools to any agent

```bash
darkops mcp
```

Starts a tools-only MCP server on stdio, implementing `initialize`, `tools/list`, and `tools/call` over newline-delimited JSON-RPC 2.0. Register it with any MCP client to give that agent repository-scale evidence without it reading the whole tree itself.

```jsonc
{ "mcpServers": { "darkops": { "command": "darkops", "args": ["mcp"] } } }
```

The server advertises only the `tools` capability. There are no resources, prompts, or sampling.
