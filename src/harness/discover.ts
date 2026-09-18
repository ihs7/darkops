import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { isSourcePath, isTestPath } from "./languages";

const execFileAsync = promisify(execFile);

export type UnitKind = "source" | "test";
export type SkipReason = "too_large" | "unreadable";
export type DiscoveryMode = "git" | "walk";

export interface SourceUnit {
  path: string;
  relPath: string;
  kind: UnitKind;
  content: string;
  hash: string;
  bytes: number;
  lines: number;
}

export interface SkippedFile {
  relPath: string;
  reason: SkipReason;
  bytes: number | null;
}

export interface DiscoverOptions {
  root?: string;
  ignoreDirs?: ReadonlySet<string>;
  maxBytes?: number;
}

export interface DiscoverResult {
  root: string;
  mode: DiscoveryMode;
  units: SourceUnit[];
  skipped: SkippedFile[];
}

const GENERATED = /\.(?:min|bundle|generated|gen)\.[cm]?[jt]sx?$/i;
const GENERATED_OTHER = /(?:\.pb\.go|_pb2\.py|\.generated\.\w+)$/i;

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".darkops",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".output",
  ".astro",
  ".vinxi",
  ".wrangler",
  "vendor",
  "third_party",
  "bower_components",
  "jspm_packages",
  ".yarn",
  "storybook-static",
  "target",
  "__generated__",
]);

const IGNORE_FILES = [".gitignore", ".darkopsignore"];
const DEFAULT_MAX_BYTES = 64 * 1024;

export async function discoverSourceUnits(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const root = options.root ?? process.cwd();
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const patterns = await loadIgnorePatterns(root);

  const tracked = await gitRelPaths(root);
  if (tracked) {
    const relPaths = tracked.filter((relPath) => isCandidate(relPath, ignoreDirs, patterns));
    return collect(root, relPaths, maxBytes, "git");
  }

  const walked = await walk(root, root, ignoreDirs, patterns);
  return collect(root, walked, maxBytes, "walk");
}

async function loadIgnorePatterns(root: string): Promise<Ignore> {
  const matcher = ignore();
  for (const file of IGNORE_FILES) {
    const raw = await readFile(join(root, file), "utf8").catch(() => "");
    if (raw.trim()) matcher.add(raw);
  }
  return matcher;
}

export async function headCommit(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitRelPaths(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "-co", "--exclude-standard", "-z", "--", "."],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.split("\0").filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

async function walk(
  dir: string,
  root: string,
  ignoreDirs: ReadonlySet<string>,
  patterns: Ignore,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return [];

  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name) || entry.name.startsWith(".")) continue;
      found.push(...(await walk(full, root, ignoreDirs, patterns)));
      continue;
    }

    if (!entry.isFile()) continue;
    const relPath = relative(root, full).split(sep).join("/");
    if (isCandidate(relPath, ignoreDirs, patterns)) found.push(relPath);
  }
  return found;
}

async function collect(
  root: string,
  relPaths: string[],
  maxBytes: number,
  mode: DiscoveryMode,
): Promise<DiscoverResult> {
  const units: SourceUnit[] = [];
  const skipped: SkippedFile[] = [];

  for (const relPath of relPaths) {
    const full = join(root, relPath);
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) continue;

    if (info.size > maxBytes) {
      skipped.push({ relPath, reason: "too_large", bytes: info.size });
      continue;
    }

    const content = await readFile(full, "utf8").catch(() => null);
    if (content === null) {
      skipped.push({ relPath, reason: "unreadable", bytes: info.size });
      continue;
    }

    units.push(makeUnit(full, relPath, content));
  }

  units.sort((a, b) => a.relPath.localeCompare(b.relPath));
  skipped.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root, mode, units, skipped };
}

function makeUnit(path: string, relPath: string, content: string): SourceUnit {
  return {
    path,
    relPath,
    kind: isTestPath(relPath) ? "test" : "source",
    content,
    hash: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    lines: content.length === 0 ? 0 : content.split("\n").length,
  };
}

function isCandidate(relPath: string, ignoreDirs: ReadonlySet<string>, patterns: Ignore): boolean {
  if (relPath.startsWith("/") || relPath.includes("..")) return false;

  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (!isSourcePath(relPath) || GENERATED.test(name) || GENERATED_OTHER.test(name)) return false;

  if (relPath.split("/").some((segment) => ignoreDirs.has(segment) || segment.startsWith("."))) {
    return false;
  }

  return !patterns.ignores(relPath);
}
