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

// IST midnight of the calendar date that is `n` days before (y,m,day). Uses UTC
// date arithmetic on the bare components (IST has no DST, so this is exact).
function istMidnightMinusDays(y: number, m: number, day: number, n: number): string {
  const d = new Date(Date.UTC(y, m - 1, day) - n * 864e5);
  return istMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Days since Monday for the given date (Mon=0 … Sun=6).
function daysSinceMonday(y: number, m: number, day: number): number {
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0=Sun … 6=Sat
  return (dow + 6) % 7;
}

// today  : since IST midnight today
// week   : This Week — Monday 00:00 of the current week → now (week is Mon–Sun)
// last3w : current week plus the previous two weeks (Monday 2 weeks back → now)
// month  : This Month — 1st of the current month 00:00 → now
export type RangeKey = "today" | "week" | "last3w" | "month" | "custom" | "all";

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

  const k = (["today", "week", "last3w", "month", "all"].includes(key) ? key : "month") as RangeKey;
  const mondayOffset = daysSinceMonday(y, m, day);
  let from: string;
  switch (k) {
    case "today":
      from = istMidnight(y, m, day);
      break;
    case "week":
      from = istMidnightMinusDays(y, m, day, mondayOffset);
      break;
    case "last3w":
      from = istMidnightMinusDays(y, m, day, mondayOffset + 14);
      break;
    case "month":
      from = istMidnight(y, m, 1);
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
