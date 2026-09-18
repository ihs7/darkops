# Use cases

darkops answers the question "where should attention go in this repository, and why" and hands the answer to a caller, either a person or an agent, which decides what to do with it. It is read-only and requires no setup: the first query builds the map.

## Orient in a large or unfamiliar repository

An agent dropped into a 5,000-file repository spends most of its context just working out where things live. A single command compiles the map and returns a ranked list.

```bash
darkops "where should engineering attention go"
```

## Focus attention on an objective

A generic ranking finds the globally hottest file. A query instead searches the map, skipping uninformative levels and backtracking, and returns a ranked list of opportunities with a trail for each.

```bash
darkops "reduce blast radius around billing"
darkops where would a new webhook integration land
```

This replaces a series of exploratory requests with a single one.

## Let an agent pull evidence on demand

Expose the read-only tools over MCP and the agent can request the evidence it needs (dependents, coupling, history) for a unit it is already looking at. It can also call `investigate` to let Jev choose the tool, or `navigate` to search for an objective.

```bash
darkops mcp   # register as an MCP server in the agent's config
```

## Keep a repeatable, low-cost view

Freshness is automatic: a later run detects what changed and pays only for those units.

```bash
darkops "improve maintainability"   # first run scans; later runs repair the map automatically
darkops "harden authentication"     # reuses the map; a repeated query makes no model calls
darkops usage                       # totals across runs
```

## What darkops does not do

darkops does not decide what to build, edit code, open pull requests, run tests, or schedule work. Those are the caller's responsibility. darkops supplies the map; the caller chooses the route.
