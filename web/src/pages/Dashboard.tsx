import { useEffect, useMemo, useState } from "react";
import { api, usePoll, useLivePunches, type Face, type RangeState } from "../lib/api";
import { Card, Stat, RangePicker, Avatar, CardSkeleton, Empty, Pill } from "../components/ui";
import { AreaChart, Donut, BarList, HourlyBars } from "../components/charts";
import { count, dayLabel, timeOf, shortName } from "../lib/format";

const CAFE_COLORS = ["#000000", "#B93E19", "#19B924", "#B99919"];

// Device labels show their meal category in brackets, e.g. "111 (Lunch/Dinner)".
const CAT_LABEL: Record<string, string> = { lunch_dinner: "Lunch/Dinner", tea: "Tea", biscuits: "Biscuit" };
const deviceLabel = (d: { device_id: string; category: string | null }) =>
  d.category ? `${d.device_id} (${CAT_LABEL[d.category] ?? d.category})` : d.device_id;

// Meal filter options shared by the Trend and Recent dropdowns. `col` picks the
// per-meal series out of the trend rows; `val` matches Face.meal for the feed.
const MEALS = [
  { k: "all", label: "All meals", col: "total", val: null as string | null },
  { k: "Lunch", label: "Lunch", col: "lunch", val: "Lunch" },
  { k: "Dinner", label: "Dinner", col: "dinner", val: "Dinner" },
  { k: "Tea", label: "Tea", col: "tea", val: "Tea" },
  { k: "Biscuit", label: "Biscuit", col: "biscuit", val: "Biscuit" },
] as const;
type MealKey = (typeof MEALS)[number]["k"];
const mealOf = (k: MealKey) => MEALS.find((m) => m.k === k)!;

export function Dashboard() {
  const [range, setRange] = useState<RangeState>({ key: "60d", from: "", to: "" });
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
  const liveInRange = range.key !== "custom" || range.to >= new Date().toLocaleDateString("en-CA");
  // Single SSE subscription feeds both lists (avoids opening two connections).
  useLivePunches((f) => {
    if (cafeName && f.cafeteria_name !== cafeName) return;
    if (mealVal && f.meal !== mealVal) return;
    setFeed((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 20)));
    if (liveInRange) setRecent((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 50)));
  });
  const recentRows = recent;

  const trendCol = mealOf(meal).col;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cafeteria Dashboard</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Meal consumption monitoring{cafeName ? ` — ${cafeName}` : " across all cafeterias"}
            {meal !== "all" ? ` · ${meal}` : ""}.
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

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} h={116} />)
        ) : data ? (
          <>
            <Stat label="Meals Served" value={count(data.totals.meals)} sub="in selected period" accent="#000000" />
            <Stat label="Today's Meals" value={count(data.today.meals)} sub={`${count(data.today.employees)} employees so far`} accent="#19B924" />
            <Stat label="Employees Fed" value={count(data.uniqueEmployees)} sub="unique, this period" accent="#B99919" />
            <Stat label="Avg / Day" value={count(data.avgPerDay)} sub={`${data.activeDevices} devices active`} accent="#B93E19" />
          </>
        ) : null}
      </div>

      {/* Trend + device share */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={`Meals Trend${meal !== "all" ? ` · ${meal}` : ""}`}
          action={<span className="text-xs text-ink-secondary">per day</span>}
        >
          {data ? (
            data.trend.length ? (
              <AreaChart
                data={data.trend.map((t) => ({ label: dayLabel(t.d), value: (t as any)[trendCol] as number }))}
                height={200}
                color={meal === "all" ? "#000000" : "#B93E19"}
              />
            ) : (
              <Empty>No meals in this period.</Empty>
            )
          ) : (
            <CardSkeleton h={200} />
          )}
        </Card>

        <Card title="Device Share">
          {data ? (
            data.devices.length ? (
              <div className="flex flex-col items-center gap-4">
                <Donut
                  size={176}
                  centerLabel={count(data.totals.meals)}
                  centerSub="total meals"
                  segments={data.devices.map((c, i) => ({
                    value: c.meals,
                    color: CAFE_COLORS[i % CAFE_COLORS.length],
                    label: deviceLabel(c),
                  }))}
                />
                <div className="grid w-full grid-cols-1 gap-1.5">
                  {data.devices.map((c, i) => (
                    <div key={c.device_id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAFE_COLORS[i % CAFE_COLORS.length] }} />
                        {deviceLabel(c)}
                      </span>
                      <span className="tnum font-semibold">{count(c.meals)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty>No device data.</Empty>
            )
          ) : (
            <CardSkeleton h={260} />
          )}
        </Card>
      </div>

      {/* By cafeteria + by meal */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Meals by Cafeteria">
          {data ? (
            data.byCafeteria.length ? (
              <BarList items={data.byCafeteria.map((c) => ({ label: c.name, value: c.meals }))} />
            ) : (
              <Empty>No data.</Empty>
            )
          ) : (
            <CardSkeleton h={200} />
          )}
        </Card>

        <Card title="By Meal">
          {data ? (
            data.meals.length ? (
              <BarList color="#B93E19" items={data.meals.map((m) => ({ label: m.meal, value: m.meals }))} />
            ) : (
              <Empty>No meal data.</Empty>
            )
          ) : (
            <CardSkeleton h={200} />
          )}
        </Card>
      </div>

      {/* Today by Hour — full width */}
      <Card title="Today by Hour" action={<span className="pill bg-black/5 text-ink-secondary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> live</span>}>
        {data ? <HourlyBars data={data.hourly} height={220} /> : <CardSkeleton h={240} />}
      </Card>

      {/* Recent punches — honors cafeteria + meal + date range */}
      <Card title="Recent" action={<span className="text-xs text-ink-secondary">in selected range</span>}>
        {recentRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Cafeteria</th>
                  <th className="py-2 font-medium">Meal</th>
                  <th className="py-2 font-medium">Device</th>
                  <th className="py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((f, i) => (
                  <tr key={f.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.02] ${i === 0 ? "animate-fade-up" : ""}`}>
                    <td className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar empId={f.emp_id} name={f.name} imageUrl={f.has_image ? `/faces/${f.id}` : undefined} size={34} ring={i === 0 ? "#19B924" : undefined} />
                        <div>
                          <div className="font-medium">{f.name ?? "Unknown"}</div>
                          <div className="tnum text-xs text-ink-secondary">{f.emp_id ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-ink-secondary">{f.cafeteria_name ?? "—"}</td>
                    <td className="py-2.5">{f.meal ? <Pill>{f.meal}</Pill> : <span className="text-ink-secondary">—</span>}</td>
                    <td className="py-2.5 tnum">{f.device_id ?? "—"}</td>
                    <td className="py-2.5 text-right tnum text-ink-secondary">{timeOf(f.punched_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No punches for this selection.</Empty>
        )}
      </Card>
    </div>
  );
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
                {(f.meal ? f.meal + " · " : "") + (f.device_id ?? "—")} · {timeOf(f.punched_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
