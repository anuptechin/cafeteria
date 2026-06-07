import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("✓ schema applied (tables, indexes)");

  // Seed the employee master roster if the generated data file is present.
  // Idempotent (upsert by emp_id) — safe on every boot. Lets prod populate
  // emp_data without the CSV being shipped in the image.
  const seedPath = path.join(__dirname, "emp_data.seed.sql");
  if (fs.existsSync(seedPath)) {
    await pool.query(fs.readFileSync(seedPath, "utf8"));
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM emp_data");
    console.log(`✓ emp_data seeded (${rows[0].n} rows)`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("✗ setup failed:", e);
  process.exit(1);
});
