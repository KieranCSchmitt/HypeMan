/** A small, deterministic calculation surface. No JavaScript or external workbook links. */
export interface TableExport { filename: string; csv: string; rows: (string | number | boolean | null)[][]; columns: string[] }
type Cell = string | number | boolean | null;
const cellReference = /^([A-Z]+)([1-9]\d*)$/;
function reference(value: string): [number, number] {
  const match = value.match(cellReference);
  if (!match) throw new Error(`Invalid cell: ${value}`);
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  return [Number(match[2]) - 2, column - 1]; // Header is row 1.
}
export function calculateTable(args: Record<string, unknown>): TableExport {
  if (args.format && String(args.format).toLowerCase() !== "csv") throw new Error("CSV export is available. Request CSV to open it in Excel or Sheets.");
  if (!Array.isArray(args.columns) || !args.columns.length || args.columns.length > 50 || !args.columns.every((value) => typeof value === "string" && value.length <= 200)) throw new Error("Provide 1–50 column names.");
  const columns = args.columns as string[];
  if (!Array.isArray(args.rows) || !args.rows.length || args.rows.length > 1000 || args.rows.length * columns.length > 10000) throw new Error("Provide 1–1,000 rows, up to 10,000 cells.");
  const rows: Cell[][] = args.rows.map((row) => {
    const values = Array.isArray(row) ? row : row && typeof row === "object" ? columns.map((column) => (row as Record<string, unknown>)[column] ?? null) : null;
    if (!values || values.length !== columns.length || values.some((value) => value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 6000)) throw new Error("Each row must match the columns and contain text, finite numbers, booleans, or empty cells.");
    return values as Cell[];
  });
  const cache = new Map<string, Cell>(), visiting = new Set<string>();
  function valueAt(row: number, column: number): Cell {
    if (row < 0 || row >= rows.length || column < 0 || column >= columns.length) throw new Error("Formula references a cell outside this table.");
    const key = row + ":" + column;
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) throw new Error("The table contains a circular formula.");
    if (visiting.size >= 100) throw new Error("Formula dependencies are too deep.");
    visiting.add(key);
    const raw = rows[row][column];
    const value = typeof raw === "string" && raw.startsWith("=") ? formula(raw.slice(1)) : raw;
    visiting.delete(key); cache.set(key, value); return value;
  }
  function numeric(value: Cell): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("A calculation references a non-numeric cell. Enter the value as a number."); return value; }
  function formula(expression: string): number {
    if (expression.length > 1000) throw new Error("Formula is too long.");
    const tokens = expression.toUpperCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Z]+[1-9]\d*|[A-Z]+|[()+\-*/,:]/g) || [];
    if (tokens.join("") !== expression.toUpperCase().replace(/\s/g, "")) throw new Error("Unsupported formula. Use numbers, cell references, + − × ÷, SUM, AVERAGE, MIN, or MAX.");
    let at = 0;
    const take = () => tokens[at++];
    function primary(): number {
      const token = take();
      if (token === "+") return primary();
      if (token === "-") return -primary();
      if (token === "(") { const value = sum(); if (take() !== ")") throw new Error("Unbalanced formula."); return value; }
      if (cellReference.test(token || "")) { const [r, c] = reference(token); return numeric(valueAt(r, c)); }
      if (["SUM", "AVERAGE", "MIN", "MAX"].includes(token)) {
        if (take() !== "(") throw new Error("Function needs parentheses.");
        const values: number[] = [];
        do {
          if (cellReference.test(tokens[at] || "") && tokens[at + 1] === ":") {
            const [r1, c1] = reference(take()); take(); const [r2, c2] = reference(take());
            if (r2 < r1 || c2 < c1 || (r2 - r1 + 1) * (c2 - c1 + 1) > 10000) throw new Error("Invalid formula range.");
            for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) values.push(numeric(valueAt(r, c)));
          } else values.push(sum());
          if (tokens[at] !== ",") break;
          take();
        } while (at < tokens.length);
        if (take() !== ")" || !values.length) throw new Error("Invalid function arguments.");
        return token === "SUM" ? values.reduce((a, b) => a + b, 0) : token === "AVERAGE" ? values.reduce((a, b) => a + b, 0) / values.length : token === "MIN" ? Math.min(...values) : Math.max(...values);
      }
      if (!token || !/^(?:\d|\.)/.test(token) || !Number.isFinite(Number(token))) throw new Error("Unsupported formula value.");
      return Number(token);
    }
    function product(): number { let value = primary(); while (["*", "/"].includes(tokens[at])) { const operation = take(), rhs = primary(); if (operation === "/" && rhs === 0) throw new Error("Cannot divide by zero."); value = operation === "*" ? value * rhs : value / rhs; } return value; }
    function sum(): number { let value = product(); while (["+", "-"].includes(tokens[at])) { const operation = take(), rhs = product(); value = operation === "+" ? value + rhs : value - rhs; } return value; }
    const value = sum();
    if (at !== tokens.length || !Number.isFinite(value)) throw new Error("Invalid or non-finite calculation.");
    return Number(value.toPrecision(12));
  }
  const calculated = rows.map((row, r) => row.map((_, c) => valueAt(r, c)));
  const escape = (value: Cell) => {
    // Text must never become executable spreadsheet formula syntax on opening the CSV.
    let text = value === null ? "" : String(value);
    if (typeof value === "string" && /^[\s\t\r]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const csv = "\uFEFF" + [columns, ...calculated].map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
  const filename = String(args.filename || "hypeman-table").replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "hypeman-table";
  return { filename: filename + ".csv", csv, rows: calculated, columns };
}
export function downloadTable(table: TableExport) {
  const url = URL.createObjectURL(new Blob([table.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = table.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
