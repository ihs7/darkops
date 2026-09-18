import type { AuthorTally, FileHistory } from "./types";

export function tallyAuthor(
  tally: Map<string, AuthorTally>,
  author: string,
  recent: boolean,
): void {
  const counts = tally.get(author) ?? { all: 0, recent: 0 };
  counts.all += 1;
  if (recent) counts.recent += 1;
  tally.set(author, counts);
}

export function finalizeAuthorship(
  files: Map<string, FileHistory>,
  authors: Map<string, Map<string, AuthorTally>>,
): void {
  for (const [path, entry] of files) {
    const tally = authors.get(path);
    if (!tally || tally.size === 0) continue;

    entry.authors = tally.size;
    let recentTotal = 0;
    let top = 0;
    for (const counts of tally.values()) {
      if (counts.recent > 0) entry.recentAuthors += 1;
      recentTotal += counts.recent;
      if (counts.recent > top) top = counts.recent;
    }
    entry.primaryAuthorShare = recentTotal > 0 ? top / recentTotal : 0;
  }
}
