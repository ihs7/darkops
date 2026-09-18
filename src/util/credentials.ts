import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { DarkopsError } from "./errors";

export const API_KEY_ENV = "TYPESAFE_API_KEY";
export const CONFIG_DIR_ENV = "DARKOPS_CONFIG_DIR";

const XDG_CONFIG_HOME = "XDG_CONFIG_HOME";
const ENV_FILE = ".env";

export type CredentialSource = "environment" | "repository" | "user";

export interface CredentialResolution {
  source: CredentialSource;
  key: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env[CONFIG_DIR_ENV]) return env[CONFIG_DIR_ENV];
  const base = env[XDG_CONFIG_HOME] || join(homedir(), ".config");
  return join(base, "darkops");
}

export function repositoryEnvFile(root: string): string {
  return join(root, ENV_FILE);
}

export function userEnvFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), ENV_FILE);
}

export function loadCredentials(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): CredentialResolution | undefined {
  const repository = readEnvFile(repositoryEnvFile(root));
  const user = readEnvFile(userEnvFile(env));
  const resolved = resolveKey(env, repository, user);
  applyLayer(env, repository);
  applyLayer(env, user);
  return resolved;
}

export function requireCredentials(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): CredentialResolution {
  const resolved = loadCredentials(root, env);
  if (resolved) return resolved;
  throw new DarkopsError(
    "AUTH",
    `No ${API_KEY_ENV} found.`,
    "Run `darkops auth --key <key>`, or set it in the environment.",
  );
}

export function missingCredentialsMessage(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return [
    `No ${API_KEY_ENV} found.`,
    "Set it in your environment, or store it once with `darkops auth --key <key>`.",
    "Looked in:",
    `  ${repositoryEnvFile(root)}`,
    `  ${userEnvFile(env)}`,
  ].join("\n");
}

export function writeUserApiKey(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = clean(key);
  if (!value) throw new Error("The API key is empty.");
  if (/[\r\n]/.test(value)) throw new Error("The API key must be a single line.");
  const dir = configDir(env);
  const file = userEnvFile(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, upsert(existing, API_KEY_ENV, value), { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "********";
  return `***${key.slice(-4)}`;
}

export function sourceLabel(
  source: CredentialSource,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (source === "environment") return "the environment";
  if (source === "repository") return repositoryEnvFile(root);
  return userEnvFile(env);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readEnvFile(file: string): NodeJS.ProcessEnv {
  if (!existsSync(file)) return {};
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function resolveKey(
  env: NodeJS.ProcessEnv,
  repository: NodeJS.ProcessEnv,
  user: NodeJS.ProcessEnv,
): CredentialResolution | undefined {
  const fromEnvironment = clean(env[API_KEY_ENV]);
  if (fromEnvironment) return { source: "environment", key: fromEnvironment };
  const fromRepository = clean(repository[API_KEY_ENV]);
  if (fromRepository) return { source: "repository", key: fromRepository };
  const fromUser = clean(user[API_KEY_ENV]);
  if (fromUser) return { source: "user", key: fromUser };
  return undefined;
}

function applyLayer(env: NodeJS.ProcessEnv, values: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(values)) {
    if (clean(env[name]) === undefined) env[name] = value;
  }
}

function upsert(text: string, name: string, value: string): string {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!pattern.test(line)) return line;
    found = true;
    return `${name}=${value}`;
  });
  if (found) return next.join("\n");
  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  next.push(`${name}=${value}`, "");
  return next.join("\n");
}
