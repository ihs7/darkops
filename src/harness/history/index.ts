import { finalizeAuthorship, tallyAuthor } from "./authorship";
import { commitMoment, readCommits } from "./commits";
import { applyCouplings, recordCoChanges } from "./coupling";
import type {
  AuthorTally,
  CommitMoment,
  FileHistory,
  HistoryOptions,
  HistoryResult,
} from "./types";

export type { Coupling, FileHistory, HistoryOptions, HistoryResult } from "./types";

export async function collectHistory(options: HistoryOptions = {}): Promise<HistoryResult> {
  const root = options.root ?? process.cwd();
  const windowDays = options.windowDays ?? 90;
  const maxCommits = options.maxCommits ?? 20000;
  const maxChangeset = options.maxChangeset ?? 25;
  const minCoChanges = options.minCoChanges ?? 3;
  const topCouplings = options.topCouplings ?? 5;
  const allow = options.paths;

  const commits = await readCommits(root, maxCommits);
  const cutoff = Date.now() - windowDays * 86_400_000;

  const files = new Map<string, FileHistory>();
  const authors = new Map<string, Map<string, AuthorTally>>();
  const coChanges = new Map<string, number>();

  for (const commit of commits) {
    const touched = sourcePaths(commit.files, allow);
    if (touched.length === 0) continue;
    const moment = commitMoment(commit, cutoff);
    touchFiles(files, authors, touched, commit.author, moment);
    recordCoChanges(coChanges, touched, maxChangeset);
  }

  finalizeAuthorship(files, authors);
  const coupledPairs = applyCouplings(files, coChanges, minCoChanges, topCouplings);

  return { files, commits: commits.length, windowDays, coupledPairs };
}

function sourcePaths(files: string[], allow?: ReadonlySet<string>): string[] {
  return allow ? files.filter((file) => allow.has(file)) : files;
}

function touchFiles(
  files: Map<string, FileHistory>,
  authors: Map<string, Map<string, AuthorTally>>,
  paths: string[],
  author: string,
  moment: CommitMoment,
): void {
  for (const path of paths) {
    const entry = ensureFile(files, path);
    entry.commits += 1;
    if (moment.recent) entry.recentCommits += 1;
    if (moment.bugfix) entry.bugFixCommits += 1;
    if (moment.revert) entry.revertCommits += 1;
    entry.lastModified = later(entry.lastModified, moment.date);
    entry.firstSeen = earlier(entry.firstSeen, moment.date);

    if (!moment.bot) tallyAuthor(ensureMap(authors, path), author, moment.recent);
  }
}

function ensureFile(files: Map<string, FileHistory>, path: string): FileHistory {
  const existing = files.get(path);
  if (existing) return existing;
  const created: FileHistory = {
    commits: 0,
    recentCommits: 0,
    authors: 0,
    recentAuthors: 0,
    primaryAuthorShare: 0,
    bugFixCommits: 0,
    revertCommits: 0,
    lastModified: null,
    firstSeen: null,
    sumCoupling: 0,
    couplings: [],
  };
  files.set(path, created);
  return created;
}

function ensureMap<K, V>(map: Map<K, Map<string, V>>, key: K): Map<string, V> {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Map<string, V>();
  map.set(key, created);
  return created;
}

function later(current: string | null, candidate: string): string {
  return !current || candidate > current ? candidate : current;
}

function earlier(current: string | null, candidate: string): string {
  return !current || candidate < current ? candidate : current;
}
