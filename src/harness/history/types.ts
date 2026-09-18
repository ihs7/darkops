export interface Coupling {
  path: string;
  coChanges: number;
  strength: number;
}

export interface FileHistory {
  commits: number;
  recentCommits: number;
  authors: number;
  recentAuthors: number;
  primaryAuthorShare: number;
  bugFixCommits: number;
  revertCommits: number;
  lastModified: string | null;
  firstSeen: string | null;
  sumCoupling: number;
  couplings: Coupling[];
}

export interface HistoryOptions {
  root?: string;
  paths?: ReadonlySet<string>;
  windowDays?: number;
  maxCommits?: number;
  maxChangeset?: number;
  minCoChanges?: number;
  topCouplings?: number;
}

export interface HistoryResult {
  files: Map<string, FileHistory>;
  commits: number;
  windowDays: number;
  coupledPairs: number;
}

export interface Commit {
  author: string;
  date: string;
  subject: string;
  files: string[];
}

export interface CommitMoment {
  date: string;
  recent: boolean;
  bot: boolean;
  bugfix: boolean;
  revert: boolean;
}

export interface AuthorTally {
  all: number;
  recent: number;
}
