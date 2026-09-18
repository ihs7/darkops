import type { Coupling, FileHistory } from "./types";

const PAIR = "\u0000";

export function recordCoChanges(
  coChanges: Map<string, number>,
  paths: string[],
  maxChangeset: number,
): void {
  if (paths.length < 2 || paths.length > maxChangeset) return;

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const key = pairKey(paths[i] as string, paths[j] as string);
      coChanges.set(key, (coChanges.get(key) ?? 0) + 1);
    }
  }
}

export function applyCouplings(
  files: Map<string, FileHistory>,
  coChanges: Map<string, number>,
  minCoChanges: number,
  topCouplings: number,
): number {
  const perFile = new Map<string, Coupling[]>();
  let coupledPairs = 0;

  for (const [key, count] of coChanges) {
    if (count < minCoChanges) continue;
    const [a, b] = key.split(PAIR) as [string, string];
    const against = files.get(a);
    const other = files.get(b);
    if (!against || !other) continue;

    const strength = count / Math.min(against.commits, other.commits);
    coupledPairs += 1;
    pushCoupling(perFile, a, { path: b, coChanges: count, strength });
    pushCoupling(perFile, b, { path: a, coChanges: count, strength });
  }

  for (const list of perFile.values()) list.sort((x, y) => y.strength - x.strength);
  for (const [path, entry] of files) {
    const list = perFile.get(path) ?? [];
    entry.couplings = list.slice(0, topCouplings);
    entry.sumCoupling = list.length;
  }

  return coupledPairs;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}${PAIR}${b}` : `${b}${PAIR}${a}`;
}

function pushCoupling(map: Map<string, Coupling[]>, path: string, coupling: Coupling): void {
  const list = map.get(path);
  if (list) list.push(coupling);
  else map.set(path, [coupling]);
}
