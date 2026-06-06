import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

// Index of employee photos living in FACES_DIR. The fixed-digit emp_id is
// embedded in the filename (any prefix, e.g. "ssddb_80014105.svg"). We map
// emp_id -> absolute file path so lookups + serving are instant.

let index = new Map<string, string>();

const EXT_RE = /(\d{3,})\.(svg|png|jpe?g|webp)$/i;

export function buildPhotoIndex(): number {
  index = new Map();
  if (!fs.existsSync(env.facesDir)) return 0;
  for (const f of fs.readdirSync(env.facesDir)) {
    const m = f.match(EXT_RE);
    if (m) index.set(m[1], path.join(env.facesDir, f));
  }
  return index.size;
}

export function photoPath(empId: string): string | undefined {
  if (index.size === 0) buildPhotoIndex();
  return index.get(empId);
}

export function photoIds(): string[] {
  buildPhotoIndex(); // cheap re-scan so newly added files appear without restart
  return [...index.keys()];
}

export function contentTypeFor(file: string): string {
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
