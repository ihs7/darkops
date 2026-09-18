import { discoverSourceUnits } from "../harness/discover";
import type { Progress } from "../report/progress";
import { loadRun, repositoryFingerprint, type RunRecord } from "../state/store";
import { DarkopsError } from "../util/errors";
import { runScan, type ScanOptions } from "./scan";

export const MAX_BYTES = 65536;

export interface EnsureOptions {
  root: string;
  runId?: string;
  force?: boolean;
  model?: string;
  progress?: Progress;
  scan?: (options: ScanOptions) => Promise<RunRecord>;
}

export interface EnsuredRun {
  record: RunRecord;
  scanned: boolean;
}

export async function ensureRun(options: EnsureOptions): Promise<EnsuredRun> {
  if (options.runId) {
    const record = await loadRun(options.root, options.runId);
    if (!record) {
      throw new DarkopsError(
        "RUN_MISSING",
        `No run ${options.runId}.`,
        "List runs with `darkops usage`.",
      );
    }
    return { record, scanned: false };
  }

  if (!options.force) {
    const existing = await loadRun(options.root);
    if (existing && (await isRunCurrent(existing, options.root))) {
      return { record: existing, scanned: false };
    }
  }

  const scan = options.scan ?? runScan;
  const record = await scan({
    root: options.root,
    concurrency: 8,
    maxBytes: MAX_BYTES,
    force: options.force ?? false,
    model: options.model,
    progress: options.progress,
  });
  return { record, scanned: true };
}

export async function isRunCurrent(record: RunRecord, root: string): Promise<boolean> {
  if (!record.fingerprint) return false;
  if (record.model === "structural") return false;
  const { units, skipped } = await discoverSourceUnits({ root, maxBytes: MAX_BYTES });
  return repositoryFingerprint(units, skipped) === record.fingerprint;
}
