// Avatars: real photo if the emp_id has a file on the server, otherwise an
// instant inline monogram (no HTTP request — fast even for hundreds of rows).
import { useState } from "react";
import { usePhotoSet } from "../lib/photos";

const PAIRS: [string, string][] = [
  ["#1B2A4A", "#5B86E5"],
  ["#2D1B3D", "#A86CC1"],
  ["#1B3A2E", "#3CB371"],
  ["#3D2A1B", "#D98E48"],
  ["#3A1B22", "#C0566B"],
  ["#1B3540", "#39A0AD"],
  ["#2B2B2B", "#8A8A8A"],
  ["#2A2E1B", "#9FB23C"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initialsOf(name: string): string {
  const p = (name || "").trim().replace(/[^A-Za-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (!p.length) return "··";
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase();
}

export function avatarTheme(empId: string, name = "") {
  const [dark, light] = PAIRS[hash(empId + "|" + name) % PAIRS.length];
  return { dark, light, initials: initialsOf(name || empId) };
}

// Photo-aware: renders a real <img> if this emp_id has a photo file, else the
// instant inline monogram. Falls back to the monogram if the image fails.
export function FaceFill({
  empId,
  name,
  fontSize,
}: {
  empId: string;
  name: string;
  fontSize?: number | string;
}) {
  const photos = usePhotoSet();
  const [broken, setBroken] = useState(false);
  if (photos.has(empId) && !broken) {
    return (
      <img
        src={`/faces/${empId}`}
        alt={name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return <MonoAvatar empId={empId} name={name} fontSize={fontSize} />;
}

// Fills its parent (100% w/h). Caller controls size + rounding.
export function MonoAvatar({
  empId,
  name,
  fontSize,
  className = "",
}: {
  empId: string;
  name: string;
  fontSize?: number | string;
  className?: string;
}) {
  const { dark, light, initials } = avatarTheme(empId, name);
  return (
    <div
      className={`grid h-full w-full place-content-center ${className}`}
      style={{ background: dark }}
    >
      <span className="font-bold leading-none" style={{ fontSize: fontSize ?? "38%", color: light }}>
        {initials}
      </span>
    </div>
  );
}
