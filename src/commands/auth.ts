import { DarkopsError } from "../util/errors";
import {
  API_KEY_ENV,
  loadCredentials,
  maskKey,
  missingCredentialsMessage,
  sourceLabel,
  writeUserApiKey,
} from "../util/credentials";

export interface AuthOptions {
  root: string;
  key?: string;
  show: boolean;
}

export async function runAuth(options: AuthOptions): Promise<void> {
  if (options.show) {
    const resolved = loadCredentials(options.root);
    console.log(
      resolved
        ? `Using ${API_KEY_ENV} from ${sourceLabel(resolved.source, options.root)} (${maskKey(resolved.key)}).`
        : missingCredentialsMessage(options.root),
    );
    return;
  }

  const key = options.key ?? (await readStdin());
  if (!key) {
    throw new DarkopsError(
      "USAGE",
      "No API key provided.",
      "Pass `--key <key>` or pipe it on stdin.",
    );
  }
  const file = writeUserApiKey(key);
  console.log(`Saved ${API_KEY_ENV} to ${file}.`);
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const key = text.trim();
  return key || undefined;
}
