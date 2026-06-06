import fs from "node:fs";
import { pool } from "./db.js";
import { env } from "./env.js";

// Generate N fake A4-portrait employee photos. Filename = "ssddb_<emp_id>.svg"
// (a prefix + the fixed-digit emp_id), matching how the real image folder works.
// SVG keeps files tiny + instant; swap with real A4 JPEGs later, same naming.

const COUNT = Number(process.argv[2] ?? 30);
const PREFIX = "ssddb_";

const PAIRS: [string, string][] = [
  ["#1B2A4A", "#9DB7F5"], ["#2D1B3D", "#C9A6DC"], ["#1B3A2E", "#7FD3A6"],
  ["#3D2A1B", "#E3B488"], ["#3A1B22", "#DD93A2"], ["#1B3540", "#7FCBD4"],
  ["#2B2B2B", "#B5B5B5"], ["#2A2E1B", "#C7D67E"],
];
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const initials = (name: string) => {
  const p = (name || "").trim().replace(/[^A-Za-z\s]/g, "").split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "··";
};

// A4 portrait at ~150dpi: 1240 x 1754
function photoSvg(empId: string, name: string): string {
  const h = hash(empId);
  const [dark, light] = PAIRS[h % PAIRS.length];
  const ini = initials(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="55%" stop-color="${dark}"/>
      <stop offset="100%" stop-color="#0c0c0e"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="40%" r="75%">
      <stop offset="60%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
    </radialGradient>
  </defs>
  <rect width="1240" height="1754" fill="url(#bg)"/>
  <!-- head + shoulders silhouette -->
  <g fill="#ffffff" fill-opacity="0.16">
    <circle cx="620" cy="640" r="250"/>
    <path d="M210 1500c0-260 184-430 410-430s410 170 410 430z"/>
  </g>
  <text x="620" y="690" font-family="Hanken Grotesk, Segoe UI, Arial, sans-serif" font-size="360"
        font-weight="800" fill="#ffffff" fill-opacity="0.9" text-anchor="middle" dominant-baseline="central">${ini}</text>
  <rect width="1240" height="1754" fill="url(#vig)"/>
  <!-- bottom info band -->
  <rect x="0" y="1560" width="1240" height="194" fill="rgba(0,0,0,0.55)"/>
  <text x="70" y="1640" font-family="Hanken Grotesk, Segoe UI, Arial, sans-serif" font-size="64"
        font-weight="700" fill="#ffffff">${escapeXml(name)}</text>
  <text x="70" y="1710" font-family="ui-monospace, Consolas, monospace" font-size="46"
        fill="#ffffff" fill-opacity="0.7">ID ${empId}</text>
  <text x="1170" y="1700" font-family="ui-monospace, Consolas, monospace" font-size="34"
        fill="#ffffff" fill-opacity="0.5" text-anchor="end">D'DECOR · SAMPLE</text>
</svg>`;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

async function main() {
  fs.mkdirSync(env.facesDir, { recursive: true });
  // clear old placeholder svgs so the folder only holds current sample photos
  for (const f of fs.readdirSync(env.facesDir)) if (f.endsWith(".svg")) fs.rmSync(`${env.facesDir}/${f}`);
  const rows = await pool.query<{ emp_id: string; name: string }>(
    `SELECT emp_id, name FROM employees ORDER BY random() LIMIT $1`,
    [COUNT]
  );
  for (const r of rows.rows) {
    fs.writeFileSync(`${env.facesDir}/${PREFIX}${r.emp_id}.svg`, photoSvg(r.emp_id, r.name));
  }
  console.log(`✓ wrote ${rows.rows.length} A4 photos to ${env.facesDir}`);
  console.log(`  filename pattern: ${PREFIX}<emp_id>.svg`);
  console.log(`\nTest these IDs in the Simulator (they now have a photo):`);
  for (const r of rows.rows) console.log(`  ${r.emp_id}  ${r.name}`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗ gen-photos failed:", e);
  process.exit(1);
});
