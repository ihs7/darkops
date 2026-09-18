import { paint, type Tone } from "./style";

export type Align = "left" | "right";
export type Truncate = "end" | "path";

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
  align?: Align;
  tone?: (row: T) => Tone | undefined;
  truncate?: Truncate;
  minWidth?: number;
  maxWidth?: number;
  shrink?: boolean;
  grow?: boolean;
  drop?: number;
}

export interface TableOptions {
  color?: boolean;
  width?: number;
  indent?: string;
}

interface Layout<T> {
  columns: TableColumn<T>[];
  widths: number[];
}

const GAP = "  ";
const RULE = "─";

export function renderTable<T>(
  columns: readonly TableColumn<T>[],
  rows: readonly T[],
  options: TableOptions = {},
): string {
  const indent = options.indent ?? "";
  const color = options.color ?? false;
  const available = options.width && options.width > 0 ? options.width - indent.length : 0;

  const { columns: cols, widths } = layout(columns, rows, available);
  const lines = [headerLine(cols, widths, color), ruleLine(widths, color)];
  for (const row of rows) lines.push(rowLine(cols, widths, row, color));
  return lines.map((line) => (line.length > 0 ? indent + line.trimEnd() : line)).join("\n");
}

function layout<T>(
  columns: readonly TableColumn<T>[],
  rows: readonly T[],
  available: number,
): Layout<T> {
  let cols = [...columns];

  for (;;) {
    const widths = cols.map((col) => naturalWidth(col, rows));
    if (available > 0) shrinkToFit(cols, widths, available);
    if (available <= 0 || total(cols, widths) <= available) {
      growToFill(cols, widths, available);
      return { columns: cols, widths };
    }
    const droppable = cols.filter((col) => col.drop !== undefined);
    if (droppable.length === 0) return { columns: cols, widths };
    let victim = droppable[0] as TableColumn<T>;
    for (const col of droppable) {
      if ((col.drop ?? 0) < (victim.drop ?? 0)) victim = col;
    }
    cols = cols.filter((col) => col !== victim);
  }
}

function shrinkToFit<T>(
  columns: readonly TableColumn<T>[],
  widths: number[],
  available: number,
): void {
  let guard = 0;
  while (total(columns, widths) > available && guard < 1000) {
    guard += 1;
    let best = -1;
    let bestWidth = 0;
    columns.forEach((col, index) => {
      const width = widths[index] ?? 0;
      const min = col.minWidth ?? 0;
      if (col.shrink && width > min && width > bestWidth) {
        best = index;
        bestWidth = width;
      }
    });
    if (best < 0) return;
    widths[best] = (widths[best] ?? 0) - 1;
  }
}

function growToFill<T>(
  columns: readonly TableColumn<T>[],
  widths: number[],
  available: number,
): void {
  if (available <= 0) return;
  const extra = available - total(columns, widths);
  const growers = columns.map((col, index) => ({ col, index })).filter(({ col }) => col.grow);
  if (extra <= 0 || growers.length === 0) return;

  const each = Math.floor(extra / growers.length);
  let remainder = extra - each * growers.length;
  for (const { index } of growers) {
    let add = each;
    if (remainder > 0) {
      add += 1;
      remainder -= 1;
    }
    widths[index] = (widths[index] ?? 0) + add;
  }
}

function total<T>(columns: readonly TableColumn<T>[], widths: readonly number[]): number {
  return (
    widths.reduce((sum, width) => sum + width, 0) + GAP.length * Math.max(0, columns.length - 1)
  );
}

function naturalWidth<T>(col: TableColumn<T>, rows: readonly T[]): number {
  let width = col.header.length;
  for (const row of rows) width = Math.max(width, col.value(row).length);
  width = Math.min(width, col.maxWidth ?? Number.POSITIVE_INFINITY);
  return Math.max(width, col.minWidth ?? 0);
}

function headerLine<T>(
  columns: readonly TableColumn<T>[],
  widths: readonly number[],
  color: boolean,
): string {
  return columns
    .map((col, index) => {
      const width = widths[index] ?? col.header.length;
      const text = isLast(columns, index)
        ? col.header
        : pad(col.header, width, col.align ?? "left");
      return paint("dim", text, color);
    })
    .join(GAP);
}

function ruleLine(widths: readonly number[], color: boolean): string {
  return paint("dim", widths.map((width) => RULE.repeat(Math.max(1, width))).join(GAP), color);
}

function rowLine<T>(
  columns: readonly TableColumn<T>[],
  widths: readonly number[],
  row: T,
  color: boolean,
): string {
  return columns
    .map((col, index) => {
      const width = widths[index] ?? col.header.length;
      const fitted = fit(col.value(row), width, col.truncate);
      const text = isLast(columns, index) ? fitted : pad(fitted, width, col.align ?? "left");
      const tone = col.tone?.(row);
      return tone ? paint(tone, text, color) : text;
    })
    .join(GAP);
}

function isLast<T>(columns: readonly TableColumn<T>[], index: number): boolean {
  return index === columns.length - 1;
}

function fit(value: string, width: number, truncate: Truncate | undefined): string {
  if (value.length <= width) return value;
  if (width <= 1) return "…".slice(0, Math.max(0, width));
  if (truncate === "path") return `…${value.slice(value.length - (width - 1))}`;
  return `${value.slice(0, width - 1)}…`;
}

function pad(value: string, width: number, align: Align): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}
