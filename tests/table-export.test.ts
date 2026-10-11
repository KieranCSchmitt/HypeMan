import { describe, expect, it } from "vitest";
import { calculateTable } from "../apps/extension/src/ui/table-export";
describe("calculated spreadsheet export", () => {
  it("calculates a budget and dependent totals without executing formula text", () => {
    const table = calculateTable({ columns: ["Item", "Cost"], rows: [["Rent", 1200], ["Food", 300], ["Travel", 50], ["Total", "=SUM(B2:B4)"], ["With reserve", "=B5*1.1"]] });
    expect(table.rows[3][1]).toBe(1550); expect(table.rows[4][1]).toBe(1705);
    expect(table.csv).toContain('"Total","1550"'); expect(table.csv).not.toContain("=SUM");
  });
  it("quotes text and prevents CSV formula injection", () => {
    const table = calculateTable({ columns: ["Label"], rows: [['a,"quoted"\nline'], ["@malicious"], ["+SUM(A1)"]] });
    expect(table.csv).toContain('"a,""quoted""\nline"'); expect(table.csv).toContain("'@malicious"); expect(table.csv).toContain("'+SUM(A1)");
  });
  it.each([{ rows: [["=B2", "=A2"]], error: "circular" }, { rows: [[1, "=1/0"]], error: "divide by zero" }, { rows: [["unknown", "=A2+1"]], error: "non-numeric" }, { rows: [[1, '=HYPERLINK("https://bad")']], error: "Unsupported formula" }])("rejects unsafe or invalid calculations ($error)", ({ rows, error }) => {
    expect(() => calculateTable({ columns: ["A", "B"], rows })).toThrow(error);
  });
  it("does not label a CSV as an XLSX workbook", () => expect(() => calculateTable({ format: "xlsx", columns: ["A"], rows: [[1]] })).toThrow("CSV"));
});
