import ExcelJS from "exceljs";
import type { ExportDetailRow } from "./queries.js";

// Brand palette (from the D'Decor sheet) reused so the workbook matches the app.
const INK = "FF000000";          // Text Primary / Surface dark
const BEGE = "FFF7F5F2";         // Surface Bege
const SECONDARY = "FF5C5A52";    // Text Secondary
const WHITE = "FFFFFFFF";
const MEALS = ["Lunch", "Dinner", "Tea", "Biscuit"] as const;
const MONEY = '#,##0.00';

type Meta = { title: string; periodLabel: string; scope: string; generatedAt: string };

// Title band (bold, large) + subtitle, spanning `cols` columns. Returns the next row.
function titleBand(ws: ExcelJS.Worksheet, meta: Meta, sheet: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = meta.title;
  t.font = { name: "Calibri", bold: true, size: 20, color: { argb: INK } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = `${sheet}  ·  ${meta.periodLabel}  ·  ${meta.scope}`;
  s.font = { name: "Calibri", bold: true, size: 11, color: { argb: SECONDARY } };

  ws.mergeCells(3, 1, 3, cols);
  const g = ws.getCell(3, 1);
  g.value = `Generated ${meta.generatedAt}  ·  Vendor = Employee Paid + Company Paid`;
  g.font = { name: "Calibri", size: 9, color: { argb: SECONDARY } };
  return 5; // data starts here (row 4 left as a spacer)
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: colNumber <= 3 ? "left" : "right", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: INK } } };
  });
  row.height = 20;
}

function totalRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BEGE } };
    cell.border = { top: { style: "thin", color: { argb: INK } } };
  });
}

// ---- Employees summary sheet (all meals): meals + cost per employee ----
function buildEmployeesSheet(wb: ExcelJS.Workbook, meta: Meta, rows: ExportDetailRow[]) {
  const ws = wb.addWorksheet("Employees", { views: [{ state: "frozen", ySplit: 5 }] });
  type E = { id: string; name: string; cafeteria: string; meals: number; emp: number; co: number };
  const by = new Map<string, E>();
  for (const r of rows) {
    const key = `${r.emp_id}||${r.cafeteria_id}`;
    let e = by.get(key);
    if (!e) by.set(key, (e = { id: r.emp_id, name: r.name, cafeteria: r.cafeteria_name, meals: 0, emp: 0, co: 0 }));
    e.meals += r.cnt; e.emp += r.emp_paid; e.co += r.company_paid;
  }
  const headRow = titleBand(ws, meta, "Employees — meals & cost", 7);
  ws.columns = [
    { width: 14 }, { width: 30 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 },
  ];
  const h = ws.getRow(headRow);
  h.values = ["Emp ID", "Name", "Cafeteria", "Meals", "Employee Paid", "Company Paid", "Vendor"];
  styleHeaderRow(h);

  const emps = [...by.values()].sort((a, b) => b.meals - a.meals);
  let tMeals = 0, tEmp = 0, tCo = 0;
  emps.forEach((e) => {
    const row = ws.addRow([e.id, e.name, e.cafeteria, e.meals, e.emp, e.co, e.emp + e.co]);
    [5, 6, 7].forEach((c) => (row.getCell(c).numFmt = MONEY));
    tMeals += e.meals; tEmp += e.emp; tCo += e.co;
  });
  const tr = ws.addRow(["", "TOTAL", "", tMeals, tEmp, tCo, tEmp + tCo]);
  [5, 6, 7].forEach((c) => (tr.getCell(c).numFmt = MONEY));
  totalRow(tr);
}

// ---- One sheet per meal: employees × dates count grid + cost columns ----
function buildMealSheet(wb: ExcelJS.Workbook, meta: Meta, meal: string, rows: ExportDetailRow[], dates: string[]) {
  const ws = wb.addWorksheet(meal, { views: [{ state: "frozen", xSplit: 3, ySplit: 5 }] });
  // (emp, cafeteria) -> { id, name, cafeteria, perDate, total, emp, co }
  type E = { id: string; name: string; cafeteria: string; perDate: Map<string, number>; total: number; emp: number; co: number };
  const by = new Map<string, E>();
  for (const r of rows) {
    if (r.meal !== meal) continue;
    const key = `${r.emp_id}||${r.cafeteria_id}`;
    let e = by.get(key);
    if (!e) by.set(key, (e = { id: r.emp_id, name: r.name, cafeteria: r.cafeteria_name, perDate: new Map(), total: 0, emp: 0, co: 0 }));
    e.perDate.set(r.d, (e.perDate.get(r.d) ?? 0) + r.cnt);
    e.total += r.cnt; e.emp += r.emp_paid; e.co += r.company_paid;
  }

  const nCols = 3 + dates.length + 4; // EmpID, Name, Cafeteria, dates…, Total, Emp, Co, Vendor
  const headRow = titleBand(ws, meta, `${meal} — daily count by employee`, nCols);
  ws.columns = [
    { width: 14 }, { width: 28 }, { width: 12 },
    ...dates.map(() => ({ width: 9 })),
    { width: 9 }, { width: 15 }, { width: 15 }, { width: 15 },
  ];
  const h = ws.getRow(headRow);
  h.values = ["Emp ID", "Name", "Cafeteria", ...dates.map((d) => d.slice(5)), "Total", "Employee Paid", "Company Paid", "Vendor"];
  styleHeaderRow(h);

  const emps = [...by.values()].sort((a, b) => b.total - a.total);
  const colTotals = new Array(dates.length).fill(0);
  const moneyStart = 3 + dates.length + 2; // first money column (1-based): after Total
  let gTotal = 0, gEmp = 0, gCo = 0;
  emps.forEach((e) => {
    const cells = dates.map((d, i) => {
      const v = e.perDate.get(d) ?? 0;
      colTotals[i] += v;
      return v || null; // blank instead of 0 for a clean grid
    });
    const row = ws.addRow([e.id, e.name, e.cafeteria, ...cells, e.total, e.emp, e.co, e.emp + e.co]);
    [moneyStart, moneyStart + 1, moneyStart + 2].forEach((c) => (row.getCell(c).numFmt = MONEY));
    gTotal += e.total; gEmp += e.emp; gCo += e.co;
  });
  const tr = ws.addRow(["", "TOTAL", "", ...colTotals.map((v) => v || null), gTotal, gEmp, gCo, gEmp + gCo]);
  [moneyStart, moneyStart + 1, moneyStart + 2].forEach((c) => (tr.getCell(c).numFmt = MONEY));
  totalRow(tr);
}

// Build the whole workbook and return it as a Buffer.
export async function buildDetailWorkbook(meta: Meta, rows: ExportDetailRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "D'Decor Cafeteria MS";
  const dates = [...new Set(rows.map((r) => r.d))].sort();

  buildEmployeesSheet(wb, meta, rows);
  for (const meal of MEALS) buildMealSheet(wb, meta, meal, rows, dates);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
