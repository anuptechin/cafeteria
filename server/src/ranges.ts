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

// today : since IST midnight today
// week0 : This Week        — Monday 00:00 of the current week → now (Mon–Sun)
// week1 : Last Week        — the previous full Mon–Sun week
// week2 : Week before last — two weeks ago, full Mon–Sun week
// month : This Month       — 1st of the current month 00:00 → now
// 60d   : rolling last 60 days
export type RangeKey = "today" | "week0" | "week1" | "week2" | "month" | "60d" | "custom" | "all";

export function resolveRange(
  key: string,
  fromStr?: string,
  toStr?: string
): { from: string; to: string; key: RangeKey } {
  const now = new Date();
  const nowIso = now.toISOString();
  const { y, m, day } = parts(now);

  // Custom date filter (From–To, inclusive). Dates are YYYY-MM-DD in IST.
  if (key === "custom" && fromStr) {
    return {
      key: "custom",
      from: `${fromStr}T00:00:00+05:30`,
      to: toStr ? `${toStr}T23:59:59.999+05:30` : nowIso,
    };
  }

  const k = (["today", "week0", "week1", "week2", "month", "60d", "all"].includes(key) ? key : "month") as RangeKey;
  const mo = daysSinceMonday(y, m, day); // days since this week's Monday
  let from: string;
  let to = nowIso;
  switch (k) {
    case "today":
      from = istMidnight(y, m, day);
      break;
    case "week0": // this week: Monday → now
      from = istMidnightMinusDays(y, m, day, mo);
      break;
    case "week1": // last week: full Mon–Sun (end-exclusive at this week's Monday)
      from = istMidnightMinusDays(y, m, day, mo + 7);
      to = istMidnightMinusDays(y, m, day, mo);
      break;
    case "week2": // week before last: full Mon–Sun
      from = istMidnightMinusDays(y, m, day, mo + 14);
      to = istMidnightMinusDays(y, m, day, mo + 7);
      break;
    case "month":
      from = istMidnight(y, m, 1);
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
