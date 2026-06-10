import { useEffect, useMemo, useState } from "react";
import { api, usePoll, useLivePunches, type Face, type RangeState } from "../lib/api";
import { Card, Stat, RangePicker, Avatar, CardSkeleton, Empty } from "../components/ui";
import { AreaChart, MultiLineChart, Donut, GradientBars, HourlyBars } from "../components/charts";
import { count, dayLabel, timeOf, shortName } from "../lib/format";

// Distinct segment colours for the Location Share donut (cafeteria · meal). Cycled.
const SHARE_COLORS = [
  "#B93E19", "#2563EB", "#19B924", "#B99919",
  "#7C3AED", "#06B6D4", "#E11D48", "#0D9488",
  "#F59E0B", "#4F46E5", "#DB2777", "#65A30D",
  "#9333EA", "#0EA5E9", "#EA580C", "#000000",
];

// Consumption-type filter options shared by the Trend and Recent dropdowns. `col`
// picks the per-type series out of the trend rows; `val` matches Face.meal for the
// feed. We avoid the bare word "meal" in the UI — "All" expands to the concrete
// type names (Lunch · Dinner · Tea · Biscuit) wherever a scope is shown.
const MEALS = [
  { k: "all", label: "All", col: "total", val: null as string | null },
  { k: "Lunch", label: "Lunch", col: "lunch", val: "Lunch" },
  { k: "Dinner", label: "Dinner", col: "dinner", val: "Dinner" },
  { k: "Tea", label: "Tea", col: "tea", val: "Tea" },
  { k: "Biscuit", label: "Biscuit", col: "biscuit", val: "Biscuit" },
] as const;
type MealKey = (typeof MEALS)[number]["k"];
const mealOf = (k: MealKey) => MEALS.find((m) => m.k === k)!;

// The concrete consumption types, in display order. "All" enumerates these.
const MEAL_NAMES = ["Lunch", "Dinner", "Tea", "Biscuit"] as const;
// The active type scope as a list — the four names for "all", else the single pick.
const mealScope = (k: MealKey): readonly string[] => (k === "all" ? MEAL_NAMES : [mealOf(k).label]);
const mealScopeLabel = (k: MealKey) => mealScope(k).join(" · ");

// Filter-driven KPI title: single type → its name; all → "All" with the concrete
// types spelled out so the scope is unmistakable, e.g. "All (Lunch · Dinner · Tea
// · Biscuit)". No generic "served/serving" wording — named after the active filter.
const typeTitle = (k: MealKey) => (k === "all" ? `All (${MEAL_NAMES.join(" · ")})` : mealOf(k).label);
// Chart-figure unit noun: single type → its name ("324 Lunch"); all → none.
const unitNoun = (k: MealKey) => (k === "all" ? "" : mealOf(k).label);

// Brand-aligned tone per type, used by the Recent "Type" tags so a colour always
// means the same thing across the page.
const MEAL_TONE: Record<string, string> = {
  Lunch: "bg-success/10 text-success",
  Dinner: "bg-black/[0.07] text-ink",
  Tea: "bg-alert/15 text-[#8a7314]",
  Biscuit: "bg-error/10 text-error",
};

// Solid line colours per meal — chosen to be fully separable on thin lines:
// rust (warm), black (neutral), green, and blue (cool) instead of gold which read
// too close to green. Shared by the trend chart (consistent everywhere).
const MEAL_LINE_COLOR: Record<string, string> = {
  Lunch: "#B93E19",
  Dinner: "#000000",
  Tea: "#19B924",
  Biscuit: "#2563EB",
};

// Human label for the active date range (mirrors RangePicker's options).
const RANGE_LABEL: Record<string, string> = {
  today: "Today", week0: "This Week", week1: "Last Week",
  week2: "Week before last", month: "This Month", "60d": "Last 60 Days", all: "All time",
};
const rangeLabel = (r: RangeState) =>
  r.key === "custom" ? `${r.from || "…"} → ${r.to || "…"}` : RANGE_LABEL[r.key] ?? r.key;

export function Dashboard() {
  const [range, setRange] = useState<RangeState>({ key: "month", from: "", to: "" });
  const [cafe, setCafe] = useState<number | null>(null); // null = all cafeterias
  const [meal, setMeal] = useState<MealKey>("all");       // GLOBAL meal filter
  const mealVal = mealOf(meal).val;
  // Whole dashboard scopes to cafeteria + meal + range.
  const { data, loading, error, reload } = usePoll(() => api.dashboard(range, cafe, mealVal), [range, cafe, mealVal], 5000);

  const cafeName = useMemo(
    () => data?.cafeterias.find((c) => c.id === cafe)?.name ?? null,
    [data, cafe]
  );

  // Live ticker feed (always latest) + range-bound Recent table. Both honor the
  // cafeteria + meal selection; Recent additionally honors the date range.
  const [feed, setFeed] = useState<Face[]>([]);
  const [recent, setRecent] = useState<Face[]>([]);
  useEffect(() => {
    api.recentFaces(20, cafe, mealVal).then(setFeed).catch(() => {});
  }, [cafe, mealVal]);
  useEffect(() => {
    api.recentInRange(range, 50, cafe, mealVal).then(setRecent).catch(() => {});
  }, [range, cafe, mealVal]);

  // A live punch only joins Recent when "now" is within the selected range: any
  // preset ends at now (always), a custom range only if today ≤ its end date.
  const liveInRange = range.key !== "custom" || range.to >= new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  // Single SSE subscription feeds both lists (avoids opening two connections).
  useLivePunches((f) => {
    if (cafeName && f.cafeteria_name !== cafeName) return;
    if (mealVal && f.meal !== mealVal) return;
    setFeed((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 20)));
    if (liveInRange) setRecent((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 50)));
  });
  const recentRows = recent;

  const trendCol = mealOf(meal).col;
  const rl = rangeLabel(range);
  const types = mealScopeLabel(meal);                       // "Lunch · Dinner · …" or single
  const typeCap = meal !== "all" ? mealOf(meal).label : null; // single type, else null

  // When the range IS today, the "Today" and "Avg / Day" KPIs collapse onto the
  // headline total — so we swap in genuinely distinct metrics (peak hour, meals
  // per employee) to keep all four cards meaningful.
  const isToday = range.key === "today";
  const peak = data ? data.hourly.reduce((a, b) => (b.meals > a.meals ? b : a), { hour: 0, meals: 0 }) : null;
  const perEmp = data && data.uniqueEmployees ? data.totals.meals / data.uniqueEmployees : 0;

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cafeteria Dashboard</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Consumption monitoring{cafeName ? ` — ${cafeName}` : " across all cafeterias"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CafeteriaPicker value={cafe} onChange={setCafe} options={data?.cafeterias ?? []} />
          <MealSelect value={meal} onChange={setMeal} />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>

      <LiveTicker feed={feed.slice(0, 8)} />

      {error && (
        <Card className="border-error/30 bg-error/5">
          <div className="text-sm text-error">
            Couldn't load data: {error}.{" "}
            <button onClick={reload} className="underline">Retry</button>
          </div>
        </Card>
      )}

      {/* KPI row — each title is the active filter; the sub-line names the scope
          (cafeteria · type · range) and omits the cafeteria when it's all of them. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} h={116} />)
        ) : data ? (
          <>
            <Stat
              label={typeTitle(meal)}
              value={count(data.totals.meals)}
              sub={<FilterSub cafe={cafeName} note={rl} />}
              accent="#000000"
              icon={<Icon.Bowl />}
            />
            {isToday ? (
              <Stat
                label="Peak Hour"
                value={peak && peak.meals ? fmtHour(peak.hour) : "—"}
                sub={<FilterSub cafe={cafeName} note={peak && peak.meals ? `${count(peak.meals)} at peak` : "no punches yet"} />}
                accent="#19B924"
                icon={<Icon.Clock />}
              />
            ) : (
              <Stat
                label={meal === "all" ? `Today (${MEAL_NAMES.join(" · ")})` : `${mealOf(meal).label} · Today`}
                value={count(data.today.meals)}
                sub={<FilterSub cafe={cafeName} note={`${count(data.today.employees)} employees so far`} />}
                accent="#19B924"
                icon={<Icon.Sun />}
              />
            )}
            <Stat
              label="Employees Fed"
              value={count(data.uniqueEmployees)}
              sub={<FilterSub types={typeCap} cafe={cafeName} note="unique, this period" />}
              accent="#B99919"
              icon={<Icon.People />}
            />
            {isToday ? (
              <Stat
                label="Per Employee"
                value={perEmp ? perEmp.toFixed(1) : "0"}
                sub={<FilterSub types={typeCap} cafe={cafeName} note="avg per head" />}
                accent="#B93E19"
                icon={<Icon.Ratio />}
              />
            ) : (
              <Stat
                label="Avg / Day"
                value={count(data.avgPerDay)}
                sub={<FilterSub types={typeCap} cafe={cafeName} note={`${data.activeDevices} devices active`} />}
                accent="#B93E19"
                icon={<Icon.Trend />}
              />
            )}
          </>
        ) : null}
      </div>

      {/* Consumption trend — full-width hero so it never gets stretched by a
          taller neighbour (which was leaving an empty gap below it). */}
      <Card title={<Hd t="Consumption Trend" s={<FilterSub types={types} cafe={cafeName} note={rl} />} />} action={<Muted>per day</Muted>}>
        {data ? (
          data.trend.length ? (
            meal === "all" ? (
              // All types → one line per meal (Lunch / Dinner / Tea / Biscuit).
              <MultiLineChart
                height={240}
                labels={data.trend.map((t) => dayLabel(t.d))}
                series={[
                  { name: "Lunch", color: MEAL_LINE_COLOR.Lunch, values: data.trend.map((t) => t.lunch) },
                  { name: "Dinner", color: MEAL_LINE_COLOR.Dinner, values: data.trend.map((t) => t.dinner) },
                  { name: "Tea", color: MEAL_LINE_COLOR.Tea, values: data.trend.map((t) => t.tea) },
                  { name: "Biscuit", color: MEAL_LINE_COLOR.Biscuit, values: data.trend.map((t) => t.biscuit) },
                ]}
              />
            ) : (
              // Single type → a filled area line in that meal's colour.
              <AreaChart
                data={data.trend.map((t) => ({ label: dayLabel(t.d), value: (t as any)[trendCol] as number }))}
                height={240}
                color={MEAL_LINE_COLOR[mealOf(meal).label] ?? "#B93E19"}
                unit={unitNoun(meal)}
              />
            )
          ) : (
            <Empty>No consumption in this period.</Empty>
          )
        ) : (
          <CardSkeleton h={240} />
        )}
      </Card>

      {/* Cafeteria consumption (gradient bars) + Location share (cafeteria · meal). */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <Card className="flex flex-col" title={<Hd t="By Cafeteria" s={<FilterSub types={types} note={rl} />} />}>
          {data ? (
            data.byCafeteria.length ? (
              <div className="flex flex-1 flex-col justify-center pt-2">
                <GradientBars items={data.byCafeteria.map((c) => ({ label: c.name, value: c.meals }))} height={300} />
              </div>
            ) : (
              <Empty>No data.</Empty>
            )
          ) : (
            <CardSkeleton h={320} />
          )}
        </Card>

        <Card className="flex flex-col" title={<Hd t="Location Share" s={<FilterSub types={types} cafe={cafeName} note={rl} />} />}>
          {data ? (
            data.byCafeteriaMeal.length ? (
              <div className="flex flex-1 flex-col items-center">
                <Donut
                  size={184}
                  centerLabel={count(data.totals.meals)}
                  centerSub="total"
                  unitWord="total"
                  segments={data.byCafeteriaMeal.map((c, i) => ({
                    value: c.meals,
                    color: SHARE_COLORS[i % SHARE_COLORS.length],
                    label: `${c.cafeteria_name} ${c.meal}`,
                    sub: c.meal,
                  }))}
                />
                <div className="mt-4 max-h-44 w-full space-y-1.5 overflow-y-auto pr-1">
                  {data.byCafeteriaMeal.map((c, i) => (
                    <div key={`${c.cafeteria_name}-${c.meal}`} className="flex items-center justify-between text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
                        <span className="truncate">{c.cafeteria_name} <span className="text-ink-secondary">· {c.meal}</span></span>
                      </span>
                      <span className="tnum shrink-0 font-semibold">{count(c.meals)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty>No data.</Empty>
            )
          ) : (
            <CardSkeleton h={320} />
          )}
        </Card>
      </div>

      {/* Today by Hour — always today's window, independent of the date range. */}
      <Card
        title={<Hd t="Today by Hour" s={<FilterSub types={types} cafe={cafeName} />} />}
        action={
          <span className="pill bg-success/10 text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> today only
          </span>
        }
      >
        {data ? (
          <HourlyBars data={data.hourly} height={220} subtitle={meal === "all" ? "today" : `${mealOf(meal).label} today`} unit={unitNoun(meal)} />
        ) : (
          <CardSkeleton h={240} />
        )}
      </Card>

      {/* Recent punches — honors cafeteria + type + date range */}
      <Card
        title={<Hd t={`Recent · ${recentRows.length}`} s={<FilterSub types={typeCap} cafe={cafeName} note={rl} />} />}
      >
        {recentRows.length ? (
          <div className="-mx-1 overflow-hidden rounded-xl border border-black/[0.06]">
            <div className="max-h-[460px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface-white/95 backdrop-blur">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-secondary">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Cafeteria</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Device</th>
                    <th className="px-4 py-3 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((f, i) => (
                    <tr
                      key={f.id}
                      className={`border-t border-black/[0.05] transition-colors hover:bg-black/[0.025] ${i === 0 ? "animate-fade-up" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar empId={f.emp_id} name={f.name} imageUrl={f.has_image ? `/faces/${f.id}` : undefined} size={36} ring={i === 0 ? "#19B924" : undefined} />
                          <div className="min-w-0">
                            <div className="truncate font-medium leading-tight">{f.name ?? "Unknown"}</div>
                            <div className="tnum text-xs text-ink-secondary">{f.emp_id ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-ink">{f.cafeteria_name ?? <span className="font-normal text-ink-secondary">—</span>}</td>
                      <td className="px-4 py-2.5"><TypePill meal={f.meal} /></td>
                      <td className="px-4 py-2.5 tnum text-ink-secondary">{f.device_id ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tnum text-ink-secondary">{timeOf(f.punched_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <Empty>No punches for this selection.</Empty>
        )}
      </Card>
    </div>
  );
}

// Stacked card heading: a title with a filter-based subtitle beneath it. Rendered
// with block spans so it nests safely inside the Card's <h3>.
function Hd({ t, s }: { t: React.ReactNode; s?: React.ReactNode }) {
  return (
    <span className="block">
      <span className="block text-sm font-semibold tracking-tight">{t}</span>
      {s && <span className="mt-0.5 block text-xs font-normal leading-snug">{s}</span>}
    </span>
  );
}

// Filter-based subtitle: the consumption type(s) are BOLD and near-black so the
// active filter reads at a glance; the cafeteria is dark (always legible); the
// trailing note (range / metric) stays muted. Parts are middot-separated.
function FilterSub({ types, cafe, note }: { types?: string | null; cafe?: string | null; note?: string | null }) {
  const items: React.ReactNode[] = [];
  if (types) items.push(<strong key="t" className="font-bold text-ink">{types}</strong>);
  if (cafe) items.push(<span key="c" className="font-semibold text-ink">{cafe}</span>);
  if (note) items.push(<span key="n" className="text-ink-secondary">{note}</span>);
  if (!items.length) return null;
  return (
    <>
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1 text-ink-secondary/50">·</span>}
          {it}
        </span>
      ))}
    </>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs text-ink-secondary">{children}</span>
);

// "1 PM" style label for the busiest hour KPI.
const fmtHour = (h: number) => {
  const ap = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ap}`;
};

// Compact line icons for the KPI cards (gives each metric its own glyph so the
// four cards read as distinct at a glance).
const sv = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Icon = {
  Bowl: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><path d="M3 11h18a9 9 0 0 1-18 0Z" /><path d="M12 3v3M9 4.5v1.5M15 4.5v1.5" /></svg>),
  Sun: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></svg>),
  Clock: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  People: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7" /></svg>),
  Trend: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><path d="M3 17l5-5 4 4 8-8" /><path d="M16 4h4v4" /></svg>),
  Ratio: () => (<svg viewBox="0 0 24 24" className="h-5 w-5" {...sv}><path d="M5 19 19 5" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></svg>),
};

// Brand-coloured type tag for the Recent table.
function TypePill({ meal }: { meal: string | null }) {
  if (!meal) return <span className="text-ink-secondary">—</span>;
  return <span className={`pill ${MEAL_TONE[meal] ?? "bg-black/5 text-ink-secondary"}`}>{meal}</span>;
}

function CafeteriaPicker({
  value,
  onChange,
  options,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  options: { id: number; name: string }[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="rounded-full border bg-surface-white px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-black/10"
    >
      <option value="">All cafeterias</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

function MealSelect({ value, onChange }: { value: MealKey; onChange: (v: MealKey) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MealKey)}
      className="rounded-full border bg-surface-white px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-black/10"
    >
      {MEALS.map((m) => (
        <option key={m.k} value={m.k}>{m.label}</option>
      ))}
    </select>
  );
}

function LiveTicker({ feed }: { feed: Face[] }) {
  if (!feed.length) return null;
  return (
    <div className="card flex items-center gap-3 overflow-hidden p-3">
      <span className="pill bg-black text-white shrink-0">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> LIVE
      </span>
      <div className="flex flex-1 gap-2 overflow-hidden">
        {feed.map((f, i) => (
          <div
            key={f.id}
            className={`flex shrink-0 items-center gap-2 rounded-full border bg-surface-bege py-1 pl-1 pr-3 ${
              i === 0 ? "animate-pop-in" : ""
            }`}
          >
            <Avatar empId={f.emp_id} name={f.name} imageUrl={f.has_image ? `/faces/${f.id}` : undefined} size={26} ring={i === 0 ? "#19B924" : undefined} />
            <div className="leading-tight">
              <div className="text-xs font-medium">{shortName(f.name ?? "Unknown")}</div>
              <div className="text-[10px] text-ink-secondary">
                {(f.meal ? f.meal + " · " : "") + (f.cafeteria_name ?? "—")} · {timeOf(f.punched_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
