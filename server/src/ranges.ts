import { env } from "./env.js";

const TZ = env.tz;

// Wall-clock parts for a given instant in the app timezone (IST).
function parts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, day] = f.format(d).split("-").map(Number);
  return { y, m, day };
}

const istMidnight = (y: number, m: number, day: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+05:30`;

export type RangeKey = "today" | "7d" | "30d" | "60d" | "custom" | "all";

export function resolveRange(
  key: string,
  fromStr?: string,
  toStr?: string
): { from: string; to: string; key: RangeKey } {
  const now = new Date();
  const to = now.toISOString();
  const { y, m, day } = parts(now);

  // Custom date filter (From–To, inclusive). Dates are YYYY-MM-DD in IST.
  if (key === "custom" && fromStr) {
    return {
      key: "custom",
      from: `${fromStr}T00:00:00+05:30`,
      to: toStr ? `${toStr}T23:59:59.999+05:30` : to,
    };
  }

  const k = (["today", "7d", "30d", "60d", "all"].includes(key) ? key : "60d") as RangeKey;
  let from: string;
  switch (k) {
    case "today":
      from = istMidnight(y, m, day);
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * 864e5).toISOString();
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 864e5).toISOString();
      break;
    case "60d":
      from = new Date(now.getTime() - 60 * 864e5).toISOString();
      break;
    case "all":
    default:
      from = "1970-01-01T00:00:00Z";
  }
  return { from, to, key: k };
}

// Today's IST window (used by the live display / hourly).
export function todayWindow() {
  const { y, m, day } = parts();
  return { from: istMidnight(y, m, day), to: new Date().toISOString() };
}
