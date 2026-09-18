import { knownExtensions } from "../harness/languages";
import { CONTRACT_VERSION, EXIT_CODES } from "../util/errors";

export const VERSION = "0.1.0";

export interface Manifest {
  contract: number;
  name: string;
  version: string;
  languages: string[];
  commands: Array<{ name: string; summary: string; flags: string[]; json: boolean }>;
  environment: string[];
  exitCodes: typeof EXIT_CODES;
}

export const manifest: Manifest = {
  contract: CONTRACT_VERSION,
  name: "darkops",
  version: VERSION,
  languages: knownExtensions(),
  commands: [
    {
      name: "run",
      summary: "Search the map; ranked list of opportunities (the default command).",
      flags: [
        "--root",
        "--run",
        "--path",
        "--limit",
        "--budget",
        "--min-confidence",
        "--force",
        "--json",
        "--fields",
      ],
      json: true,
    },
    {
      name: "auth",
      summary: "Store the TypeSafe API key in the user config file.",
      flags: ["--root", "--key", "--show"],
      json: false,
    },
    {
      name: "usage",
      summary: "Jev token usage and estimated cost across runs.",
      flags: ["--root", "--limit", "--json"],
      json: true,
    },
    {
      name: "mcp",
      summary: "Serve the read-only tools (evidence, fleet, navigation) over MCP on stdio.",
      flags: ["--root", "--run", "--name"],
      json: false,
    },
    {
      name: "schema",
      summary: "Print the versioned CLI contract as JSON.",
      flags: [],
      json: true,
    },
  ],
  environment: [
    "TYPESAFE_API_KEY",
    "TYPESAFE_DEFAULT_MODEL",
    "DARKOPS_CONFIG_DIR",
    "DARKOPS_HOME",
    "DARKOPS_STATE_DIR",
    "DARKOPS_NO_PROGRESS",
    "NO_COLOR",
  ],
  exitCodes: EXIT_CODES,
};
