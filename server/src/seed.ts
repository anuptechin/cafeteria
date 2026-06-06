import fs from "node:fs";
import { pool } from "./db.js";
import { env } from "./env.js";

// ----------------------------------------------------------------
// Deterministic-ish seed: ~220 employees, 4 cafeterias, 60 days of
// punches, configurable cost model, and one avatar image per emp_id
// (filename = <emp_id>.svg, mirroring the real "image folder").
// ----------------------------------------------------------------

const FIRST = [
  "Aarav","Vivaan","Aditya","Vihaan","Arjun","Sai","Reyansh","Krishna","Ishaan","Rohan",
  "Ananya","Diya","Saanvi","Aadhya","Pari","Anika","Navya","Myra","Riya","Kiara",
  "Rahul","Amit","Sanjay","Vikram","Deepak","Manoj","Suresh","Ramesh","Pankaj","Nitin",
  "Priya","Pooja","Neha","Kavya","Sneha","Megha","Shreya","Divya","Anjali","Swati",
  "Arnav","Kabir","Yash","Dev","Aryan","Karan","Harsh","Mohit","Gaurav","Akash",
  "Isha","Tara","Nisha","Ritu","Payal","Komal","Simran","Tanvi","Bhavna","Lata",
];
const LAST = [
  "Sharma","Verma","Gupta","Mehta","Patel","Reddy","Nair","Iyer","Singh","Kumar",
  "Joshi","Desai","Chauhan","Malhotra","Kapoor","Bose","Das","Rao","Naidu","Pillai",
  "Agarwal","Bansal","Chopra","Dubey","Goel","Khanna","Mishra","Pandey","Saxena","Tiwari",
];
const DEPTS = ["Operations","Finance","HR","Engineering","Sales","Procurement","Quality","IT","Admin","Logistics"];

const DEVICES = [
  { std_id: 101, device_label: "FR-F6-A", cafeteria_name: "F6 Cafeteria A", location: "F6" },
  { std_id: 102, device_label: "FR-F6-B", cafeteria_name: "F6 Cafeteria B", location: "F6" },
  { std_id: 201, device_label: "FR-G15",  cafeteria_name: "G15 Cafeteria",  location: "G15" },
  { std_id: 301, device_label: "FR-F7",   cafeteria_name: "F7 Cafeteria",   location: "F7" },
];

const SLOTS = [
  { name: "Breakfast", start: "08:00", end: "10:00", h: [8, 9],   p: 0.45 },
  { name: "Lunch",     start: "12:30", end: "15:00", h: [12, 14], p: 0.92 },
  { name: "Tea",       start: "16:00", end: "17:30", h: [16, 17], p: 0.55 },
  { name: "Dinner",    start: "19:30", end: "22:30", h: [19, 22], p: 0.30 },
];

const AVATAR_BG = ["#000000", "#B93E19", "#B99919", "#19B924", "#2D2D2D", "#5A574C"];

const DAYS = 60;
const EMP_COUNT = 220;
const FIRST_EMP_ID = 100001; // 6-digit codes

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rand = rng(20260605);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

function initials(name: string) {
  const parts = name.split(" ");
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function avatarSvg(name: string, empId: string) {
  const bg = AVATAR_BG[Number(empId) % AVATAR_BG.length];
  const fg = bg === "#B99919" || bg === "#19B924" ? "#000000" : "#F7F5F2";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" fill="${bg}"/>
  <circle cx="120" cy="96" r="44" fill="${fg}" opacity="0.92"/>
  <path d="M48 220c0-44 34-72 72-72s72 28 72 72z" fill="${fg}" opacity="0.92"/>
  <text x="120" y="120" font-family="Hanken Grotesk, Arial, sans-serif" font-size="84" font-weight="700"
        fill="${bg}" text-anchor="middle" dominant-baseline="central">${initials(name)}</text>
</svg>`;
}

// IST wall-clock -> timestamptz ISO string (+05:30)
function istIso(d: Date, hour: number, minute: number, second: number) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}+05:30`;
}

async function main() {
  console.log("Seeding cafeteria database…");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Clean slate (TRUNCATE … RESTART IDENTITY for repeatable seeds).
    await client.query(
      "TRUNCATE punches, employees, devices, meal_slots RESTART IDENTITY CASCADE"
    );

    // Devices
    for (const d of DEVICES) {
      await client.query(
        `INSERT INTO devices(std_id, device_label, cafeteria_name, location)
         VALUES ($1,$2,$3,$4)`,
        [d.std_id, d.device_label, d.cafeteria_name, d.location]
      );
    }

    // Meal slots
    for (const s of SLOTS) {
      await client.query(
        `INSERT INTO meal_slots(name, start_time, end_time) VALUES ($1,$2,$3)`,
        [s.name, s.start, s.end]
      );
    }

    // Employees + avatars
    fs.mkdirSync(env.facesDir, { recursive: true });
    type Emp = { emp_id: string; name: string; home: number };
    const employees: Emp[] = [];
    const usedNames = new Set<string>();
    for (let i = 0; i < EMP_COUNT; i++) {
      const empId = String(FIRST_EMP_ID + i);
      let name = `${pick(FIRST)} ${pick(LAST)}`;
      let guard = 0;
      while (usedNames.has(name) && guard++ < 50) name = `${pick(FIRST)} ${pick(LAST)}`;
      usedNames.add(name);
      const home = DEVICES[Math.floor(rand() * DEVICES.length)].std_id;
      employees.push({ emp_id: empId, name, home });
      await client.query(
        `INSERT INTO employees(emp_id, name, department) VALUES ($1,$2,$3)`,
        [empId, name, pick(DEPTS)]
      );
      fs.writeFileSync(`${env.facesDir}/${empId}.svg`, avatarSvg(name, empId));
    }
    console.log(`✓ ${employees.length} employees + avatars written to ${env.facesDir}`);

    // Punches over the last DAYS days
    const now = new Date();
    const empIds: string[] = [];
    const stdIds: number[] = [];
    const times: string[] = [];

    for (let back = DAYS - 1; back >= 0; back--) {
      const day = new Date(now);
      day.setDate(now.getDate() - back);
      const dow = day.getDay(); // 0 Sun .. 6 Sat
      if (dow === 0) continue;  // cafeteria closed Sundays
      const dayLoad = dow === 6 ? 0.4 : 1.0; // lighter Saturdays

      for (const emp of employees) {
        for (const slot of SLOTS) {
          if (rand() > slot.p * dayLoad) continue;
          const hour = slot.h[0] + Math.floor(rand() * (slot.h[1] - slot.h[0] + 1));
          const minute = Math.floor(rand() * 60);
          const second = Math.floor(rand() * 60);

          // Skip the future on today.
          if (back === 0) {
            const punchLocalH = hour + minute / 60;
            const nowLocalH = now.getHours() + now.getMinutes() / 60; // host is IST
            if (punchLocalH > nowLocalH) continue;
          }

          // 82% go to their home cafeteria, else a random one.
          const std = rand() < 0.82 ? emp.home : pick(DEVICES).std_id;
          empIds.push(emp.emp_id);
          stdIds.push(std);
          times.push(istIso(day, hour, minute, second));
        }
      }
    }

    // Bulk insert via UNNEST in chunks.
    const CHUNK = 2000;
    let inserted = 0;
    for (let i = 0; i < empIds.length; i += CHUNK) {
      const e = empIds.slice(i, i + CHUNK);
      const s = stdIds.slice(i, i + CHUNK);
      const t = times.slice(i, i + CHUNK);
      const res = await client.query(
        `INSERT INTO punches(emp_id, std_id, punched_at)
         SELECT * FROM UNNEST($1::text[], $2::int[], $3::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [e, s, t]
      );
      inserted += res.rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(`✓ ${inserted} punches inserted across ${DAYS} days, 4 cafeterias`);
    console.log("Done.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("✗ seed failed:", e);
  process.exit(1);
});
