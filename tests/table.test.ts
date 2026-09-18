import { describe, expect, test } from "bun:test";
import { renderTable, type TableColumn } from "../src/report/table";

interface Row {
  name: string;
  n: number;
  note: string;
}

const rows: Row[] = [
  { name: "src/a.ts", n: 5, note: "one" },
  { name: "src/very/long/path/b.ts", n: 123, note: "two" },
];

const columns: TableColumn<Row>[] = [
  { header: "n", align: "right", value: (row) => String(row.n) },
  { header: "file", value: (row) => row.name, truncate: "path", shrink: true, minWidth: 8 },
  { header: "note", value: (row) => row.note, shrink: true, minWidth: 4, drop: 1 },
];

describe("renderTable", () => {
  test("right-aligns numbers under a ruled header", () => {
    const lines = renderTable(columns, rows).split("\n");

    expect(lines[0]).toContain("file");
    expect(lines[1]).toContain("─");
    expect(lines[2]?.startsWith("  5  src/a.ts")).toBe(true);
    expect(lines[3]?.startsWith("123  src/very/long/path/b.ts")).toBe(true);
  });

  test("shrinks to width and keeps the basename when truncating a path", () => {
    const lines = renderTable(columns, rows, { width: 20 }).split("\n");

    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines[3]).toContain("…");
    expect(lines[3]).toContain("b.ts");
  });

  test("drops the most droppable column when too narrow to shrink", () => {
    const output = renderTable(columns, rows, { width: 15 });

    expect(output).not.toContain("note");
    expect(output).not.toContain("two");
    expect(output).toContain("b.ts");
  });

  test("applies tone only when colour is enabled", () => {
    const toned: TableColumn<Row>[] = [
      {
        header: "n",
        align: "right",
        value: (row) => String(row.n),
        tone: (row) => (row.n > 100 ? "red" : "green"),
      },
    ];

    expect(renderTable(toned, [rows[0] as Row], { color: true })).toContain("\u001b[32m");
    expect(renderTable(toned, [rows[0] as Row], { color: false })).not.toContain("\u001b[");
  });
});
