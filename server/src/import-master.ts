import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

// ------------------------------------------------------------------
// Import the real employee master from the Hikvision "Person
// Information" CSV export (ID, First Name, Last Name, Department, …).
// Master columns kept: emp_id, name, department (last path segment).
// Home cafeteria is derived from the unit in the department path.
// Then regenerate a short punch history so the dashboard has data.
// ------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(
  __dirname,
  "../../Person Information_2026_06_05_11_30_18_350(Person Information).csv"
);

const HISTORY_DAYS = 14;
const SLOTS = [
  { h: [8, 9], p: 0.35 },
  { h: [12, 14], p: 0.75 },
  { h: [16, 17], p: 0.4 },
  { h: [19, 21], p: 0.18 },
];

// Minimal but correct CSV parser (handles quoted fields, commas, CRLF, "" escapes).
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        /* skip */
      } else field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Use ONLY the First Name column (it already holds the full given name in this export).
const cleanName = (first: string, _last: string) =>
  `${first ?? ""}`.replace(/\s+/g, " ").replace(/[^\w\s.&'-]/g, "").trim().replace(/[.\s]+$/, "");

const lastSegment = (deptPath: string) => {
  const seg = (deptPath ?? "").split("/").map((s) => s.trim()).filter(Boolean).pop();
  return seg || "General";
};

function homeStd(deptPath: string): number {
  const p = (deptPath ?? "").toUpperCase();
  if (p.includes("F7")) return 301;
  if (p.includes("G15")) return 201;
  if (p.includes("F6")) return /F62|2A/.test(p) ? 102 : 101;
  return 101;
}

const istIso = (d: Date, hh: number, mm: number, ss: number) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` +
  `T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+05:30`;

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  console.log("Reading:", csvPath);

  const text = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const rows = parseCSV(text);

  // Find the header row ("ID","First Name",…).
  const headerIdx = rows.findIndex(
    (r) => r[0]?.trim().toLowerCase() === "id" && /first name/i.test(r[1] ?? "")
  );
  if (headerIdx === -1) throw new Error("Could not locate the ID/First Name header row.");

  type Emp = { emp_id: string; name: string; department: string; home: number };
  const seen = new Set<string>();
  const employees: Emp[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const id = (r[0] ?? "").trim();
    if (!id || seen.has(id)) continue;
    const name = cleanName(r[1] ?? "", r[2] ?? "");
    if (!name) continue;
    seen.add(id);
    employees.push({
      emp_id: id,
      name,
      department: lastSegment(r[3] ?? ""),
      home: homeStd(r[3] ?? ""),
    });
  }
  console.log(`Parsed ${employees.length} unique employees.`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE punches, employees RESTART IDENTITY CASCADE");

    // Bulk insert employees
    const CHUNK = 1000;
    for (let i = 0; i < employees.length; i += CHUNK) {
      const slice = employees.slice(i, i + CHUNK);
      await client.query(
        `INSERT INTO employees(emp_id, name, department)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
         ON CONFLICT (emp_id) DO NOTHING`,
        [slice.map((e) => e.emp_id), slice.map((e) => e.name), slice.map((e) => e.department)]
      );
    }
    console.log(`✓ inserted ${employees.length} employees (master data)`);

    // Regenerate punch history
    const now = new Date();
    const ePunch: string[] = [];
    const sPunch: number[] = [];
    const tPunch: string[] = [];
    for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
      const day = new Date(now);
      day.setDate(now.getDate() - back);
      if (day.getDay() === 0) continue; // closed Sundays
      for (const emp of employees) {
        for (const slot of SLOTS) {
          if (Math.random() > slot.p) continue;
          const hour = slot.h[0] + Math.floor(Math.random() * (slot.h[1] - slot.h[0] + 1));
          const minute = Math.floor(Math.random() * 60);
          const second = Math.floor(Math.random() * 60);
          if (back === 0 && hour + minute / 60 > now.getHours() + now.getMinutes() / 60) continue;
          const std = Math.random() < 0.85 ? emp.home : 100 + Math.floor(Math.random() * 4);
          ePunch.push(emp.emp_id);
          sPunch.push([101, 102, 201, 301].includes(std) ? std : emp.home);
          tPunch.push(istIso(day, hour, minute, second));
        }
      }
    }

    let inserted = 0;
    const PCHUNK = 5000;
    for (let i = 0; i < ePunch.length; i += PCHUNK) {
      const res = await client.query(
        `INSERT INTO punches(emp_id, std_id, punched_at)
         SELECT * FROM UNNEST($1::text[], $2::int[], $3::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [ePunch.slice(i, i + PCHUNK), sPunch.slice(i, i + PCHUNK), tPunch.slice(i, i + PCHUNK)]
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    console.log(`✓ regenerated ${inserted} punches over ${HISTORY_DAYS} days`);
    console.log("Done. Avatars are generated on the fly — no files needed.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("✗ import failed:", e);
  process.exit(1);
});
