export const KNOWN_COMMANDS = new Set(["auth", "mcp", "schema", "usage", "run", "help"]);

const HELP_FLAGS = new Set(["-h", "--help", "-V", "--version"]);

const VALUE_FLAGS = new Set([
  "-r",
  "--root",
  "--run",
  "-p",
  "--path",
  "-l",
  "--limit",
  "--budget",
  "--min-confidence",
  "--fields",
  "--key",
  "--name",
]);

export function withDefaultCommand(argv: readonly string[]): string[] {
  const args = argv.slice(2);
  if (args.some((arg) => HELP_FLAGS.has(arg))) return [...argv];

  const command = firstPositional(args);
  if (command === undefined || !KNOWN_COMMANDS.has(command)) {
    return [...argv.slice(0, 2), "run", ...args];
  }
  return [...argv];
}

function firstPositional(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}
