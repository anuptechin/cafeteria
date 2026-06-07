// Resolve a punch's face photo from the on-disk directory HikCentral syncs to
// (env.facesDir). Files are named "<person_name>+_<emp_id>.jpg". We index the
// directory in memory (keyed by both normalized name and emp_id) and refresh on
// a TTL; a miss forces at most one rebuild per REFRESH_MIN_MS so a newly added
// photo shows up quickly without re-scanning on every request.
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

const TTL_MS = 60_000;        // proactively rebuild the index this often
const REFRESH_MIN_MS = 10_000; // but never rebuild more than once per this on misses
const SEP = "+_";              // "<name>+_<emp_id>.jpg"

type Index = { byName: Map<string, string>; byEmp: Map<string, string>; at: number };
let idx: Index | null = null;
let lastBuild = 0;

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normEmp = (s: string) => s.trim();

function build(): Index {
  const byName = new Map<string, string>();
  const byEmp = new Map<string, string>();
  try {
    for (const file of fs.readdirSync(env.facesDir)) {
      if (!/\.jpe?g$/i.test(file)) continue;
      const base = file.replace(/\.[^.]+$/, "");
      const cut = base.lastIndexOf(SEP); // split on the LAST "+_" (names may contain '+')
      if (cut < 0) continue;
      const name = base.slice(0, cut);
      const emp = base.slice(cut + SEP.length);
      // First file wins for a given key (dedupe duplicate names/ids deterministically).
      if (name && !byName.has(normName(name))) byName.set(normName(name), file);
      if (emp && !byEmp.has(normEmp(emp))) byEmp.set(normEmp(emp), file);
    }
  } catch {
    // dir missing/unreadable -> empty index; /faces falls back to monogram.
  }
  lastBuild = Date.now();
  idx = { byName, byEmp, at: lastBuild };
  return idx;
}

function lookup(i: Index, name: string | null, empId: string | null): string | null {
  if (empId && i.byEmp.has(normEmp(empId))) return i.byEmp.get(normEmp(empId))!;
  if (name && i.byName.has(normName(name))) return i.byName.get(normName(name))!;
  return null;
}

// Absolute path to the photo for (name, emp_id), or null if none on disk.
export function resolveFacePath(name: string | null, empId: string | null): string | null {
  if (!env.facesDir) return null;
  let i = idx;
  if (!i || Date.now() - i.at > TTL_MS) i = build();
  let file = lookup(i, name, empId);
  // Miss could be a just-added photo: rebuild once (rate-limited), then retry.
  if (!file && Date.now() - lastBuild > REFRESH_MIN_MS) {
    i = build();
    file = lookup(i, name, empId);
  }
  return file ? path.join(env.facesDir, file) : null;
}
