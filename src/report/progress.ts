import { formatTokens } from "../jev/pricing";
import { paint } from "./style";

export interface ProgressFields {
  current?: number;
  total?: number;
  cached?: number;
  calls?: number;
  failed?: number;
  tokens?: number;
  file?: string;
}

export interface Progress {
  readonly enabled: boolean;
  phase(label: string, fields?: ProgressFields): void;
  update(fields: ProgressFields): void;
  done(summary?: string): void;
  stop(): void;
}

export interface ProgressLineInput {
  label: string;
  fields: ProgressFields;
  frame: number;
  elapsedMs: number;
}

export interface ProgressIO {
  stream?: NodeJS.WriteStream;
  enabled?: boolean;
  color?: boolean;
  columns?: number;
  intervalMs?: number;
  now?: () => number;
  schedule?: (tick: () => void, intervalMs: number) => () => void;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 90;
const DEFAULT_COLUMNS = 80;

interface TtyLike {
  cursorTo?: (column: number) => void;
  clearLine?: (direction: number) => void;
  columns?: number;
}

interface Part {
  plain: string;
  painted: string;
}

interface RuntimeState {
  label: string;
  fields: ProgressFields;
  frame: number;
  startedAt: number;
  elapsedMs: number;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function formatProgressLine(
  input: ProgressLineInput,
  columns: number,
  color: boolean,
): string {
  const frame = FRAMES[input.frame % FRAMES.length] ?? FRAMES[0] ?? "";
  const parts: Part[] = [
    { plain: `${frame} `, painted: `${paint("cyan", frame, color)} ` },
    { plain: input.label, painted: input.label },
  ];

  const stats = statParts(input.fields, color);
  if (stats.plain.length > 0) {
    parts.push({ plain: ` · ${stats.plain}`, painted: ` · ${stats.painted}` });
  }

  const elapsed = ` · ${formatDuration(input.elapsedMs)}`;
  parts.push({ plain: elapsed, painted: paint("dim", elapsed, color) });

  if (input.fields.file) {
    const head = parts.reduce((length, part) => length + part.plain.length, 0);
    const shown = truncate(input.fields.file, Math.max(4, columns - 1 - head - 3));
    parts.push({ plain: ` · ${shown}`, painted: ` · ${paint("dim", shown, color)}` });
  }

  return parts.map((part) => part.painted).join("");
}

export function createProgress(io: ProgressIO = {}): Progress {
  const stream = io.stream ?? process.stderr;
  const enabled = io.enabled ?? defaultEnabled(stream);
  const color = io.color ?? (enabled && !process.env.NO_COLOR);
  const intervalMs = io.intervalMs ?? DEFAULT_INTERVAL_MS;
  const schedule = io.schedule ?? defaultSchedule;
  const now = io.now ?? Date.now;
  const columns = (): number => io.columns ?? ttyOf(stream).columns ?? DEFAULT_COLUMNS;

  const state: RuntimeState = {
    label: "",
    fields: {},
    frame: 0,
    startedAt: now(),
    elapsedMs: 0,
  };
  let cancel: (() => void) | null = null;
  let active = false;

  const draw = (): void => {
    if (!enabled || !active) return;
    state.elapsedMs = now() - state.startedAt;
    writeLine(stream, formatProgressLine(state, columns(), color));
  };

  const halt = (): void => {
    cancel?.();
    cancel = null;
  };

  return {
    enabled,
    phase(label, fields) {
      state.label = label;
      state.fields = fields ? { ...fields } : {};
      state.frame = 0;
      state.startedAt = now();
      active = true;
      draw();
      if (enabled && !cancel) {
        cancel = schedule(() => {
          state.frame += 1;
          draw();
        }, intervalMs);
      }
    },
    update(fields) {
      Object.assign(state.fields, fields);
    },
    done(summary) {
      active = false;
      halt();
      if (!enabled) {
        if (summary) stream.write(`${summary}\n`);
        return;
      }
      eraseLine(stream);
      if (summary) stream.write(`${paint("green", "✓", color)} ${summary}\n`);
    },
    stop() {
      active = false;
      halt();
      if (enabled) eraseLine(stream);
    },
  };
}

function statParts(fields: ProgressFields, color: boolean): Part {
  const items: Part[] = [];
  if (fields.total !== undefined) items.push(dim(`${fields.current ?? 0}/${fields.total}`, color));
  if (fields.calls !== undefined && fields.calls > 0) {
    items.push(dim(`${formatTokens(fields.calls)} calls`, color));
  }
  if (fields.cached !== undefined && fields.cached > 0) {
    items.push(dim(`${formatTokens(fields.cached)} cached`, color));
  }
  if (fields.failed !== undefined && fields.failed > 0) {
    items.push(dim(`${formatTokens(fields.failed)} failed`, color));
  }
  if (fields.tokens !== undefined && fields.tokens > 0) {
    items.push(dim(`${formatTokens(fields.tokens)} in`, color));
  }
  return {
    plain: items.map((item) => item.plain).join(" · "),
    painted: items.map((item) => item.painted).join(" · "),
  };
}

function dim(text: string, color: boolean): Part {
  return { plain: text, painted: paint("dim", text, color) };
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return "…".slice(0, Math.max(0, width));
  return `…${text.slice(text.length - (width - 1))}`;
}

function ttyOf(stream: NodeJS.WriteStream): TtyLike {
  return stream as unknown as TtyLike;
}

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  const tty = ttyOf(stream);
  if (typeof tty.cursorTo === "function" && typeof tty.clearLine === "function") {
    tty.cursorTo(0);
    tty.clearLine(0);
    stream.write(line);
    return;
  }
  stream.write(`\x1b[2K\r${line}`);
}

function eraseLine(stream: NodeJS.WriteStream): void {
  const tty = ttyOf(stream);
  if (typeof tty.cursorTo === "function" && typeof tty.clearLine === "function") {
    tty.cursorTo(0);
    tty.clearLine(0);
    return;
  }
  stream.write("\x1b[2K\r");
}

function defaultSchedule(tick: () => void, intervalMs: number): () => void {
  const handle = setInterval(tick, intervalMs);
  (handle as { unref?: () => void }).unref?.();
  return () => clearInterval(handle);
}

function defaultEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env.DARKOPS_NO_PROGRESS) return false;
  return stream.isTTY === true;
}
