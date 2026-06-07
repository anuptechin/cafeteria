// Import the employee master roster into `emp_data` from the Hikvision
// "Person Information" CSV export. Takes the first three columns —
// Emp_ID, Emp_Name, Department — and upserts by emp_id (idempotent:
// re-running refreshes names/departments without creating duplicates).
//
// Usage:  npm -w server run db:import-emp -- "../Person Information_....csv"
// Default path (when no arg given) is the export at the repo root.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(
  __dirname,
  "../../Person Information_2026_06_05_11_30_18_350(Person Information).csv"
);

// Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas,
// doubled "" escapes, CRLF). Returns rows of string cells.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cur); cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function main() {
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`✗ CSV not found: ${csvPath}`);
    process.exit(1);
  }

  // strip a UTF-8 BOM if present, then parse.
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c.trim() !== ""));

  // Verify the header is the expected export, then drop it.
  const header = rows.shift() ?? [];
  const cols = header.map((h) => h.trim().toLowerCase());
  if (cols[0] !== "emp_id" || cols[1] !== "emp_name" || cols[2] !== "department") {
    console.error(
      `✗ Unexpected header (want Emp_ID, Emp_Name, Department): ${header.slice(0, 3).join(", ")}`
    );
    process.exit(1);
  }

  // Build (emp_id, emp_name, department) tuples, skipping blank ids and
  // de-duplicating on emp_id (last row wins) so the upsert never collides
  // with itself inside one statement.
  const byId = new Map<string, [string, string, string]>();
  for (const r of rows) {
    const emp_id = (r[0] ?? "").trim();
    if (!emp_id) continue;
    byId.set(emp_id, [emp_id, (r[1] ?? "").trim(), (r[2] ?? "").trim()]);
  }
  const records = [...byId.values()];
  if (!records.length) {
    console.error("✗ No data rows found in CSV");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Bulk upsert in chunks to keep parameter counts under Postgres' limit.
    const CHUNK = 1000;
    let written = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: string[] = [];
      slice.forEach((rec, j) => {
        const b = j * 3;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
        params.push(rec[0], rec[1], rec[2]);
      });
      const res = await client.query(
        `INSERT INTO emp_data (emp_id, emp_name, department)
         VALUES ${values.join(", ")}
         ON CONFLICT (emp_id) DO UPDATE
           SET emp_name = EXCLUDED.emp_name,
               department = EXCLUDED.department`,
        params
      );
      written += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    const { rows: countRows } = await client.query("SELECT count(*)::int AS n FROM emp_data");
    console.log(`✓ imported ${records.length} rows (emp_data now has ${countRows[0].n})`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error("✗ import failed:", e);
  process.exit(1);
});
