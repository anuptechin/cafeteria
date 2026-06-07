import { useEffect, useState } from "react";
import { api, usePoll, useLivePunches, type Face, type RangeState } from "../lib/api";
import { Card, Stat, RangePicker, Avatar, CardSkeleton, Empty } from "../components/ui";
import { AreaChart, Donut, BarList, HourlyBars } from "../components/charts";
import { count, dayLabel, timeOf, shortName } from "../lib/format";

const CAFE_COLORS = ["#000000", "#B93E19", "#19B924", "#B99919"];

export function Dashboard() {
  const [range, setRange] = useState<RangeState>({ key: "60d", from: "", to: "" });
  const { data, loading, error, reload } = usePoll(() => api.dashboard(range), [range], 5000);

  // Live recent punches (SSE) — used for the ticker and the Recent list.
  const [feed, setFeed] = useState<Face[]>([]);
  useEffect(() => {
    api.recentFaces(15).then(setFeed).catch(() => {});
  }, []);
  useLivePunches((f) => setFeed((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 15))));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cafeteria Dashboard</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Real-time meal consumption monitoring across all cafeterias — who ate, where, and when.
          </p>
        </div>
        <RangePicker value={range} onChange={setRange} />
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

      {/* Trend + cafeteria share */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Meals Trend" action={<span className="text-xs text-ink-secondary">per day</span>}>
          {data ? (
            data.trend.length ? (
              <AreaChart data={data.trend.map((t) => ({ label: dayLabel(t.d), value: t.meals }))} height={200} />
            ) : (
              <Empty>No meals in this period.</Empty>
            )
          ) : (
            <CardSkeleton h={200} />
          )}
        </Card>

        <Card title="Device Share">
          {data ? (
            <div className="flex flex-col items-center gap-4">
              <Donut
                size={176}
                centerLabel={count(data.totals.meals)}
                centerSub="total meals"
                segments={data.devices.map((c, i) => ({
                  value: c.meals,
                  color: CAFE_COLORS[i % CAFE_COLORS.length],
                  label: c.device_id,
                }))}
              />
              <div className="grid w-full grid-cols-1 gap-1.5">
                {data.devices.map((c, i) => (
                  <div key={c.device_id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAFE_COLORS[i % CAFE_COLORS.length] }} />
                      {c.device_id}
                    </span>
                    <span className="tnum font-semibold">{count(c.meals)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <CardSkeleton h={260} />
          )}
        </Card>
      </div>

      {/* Devices + slots */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Meals by Device">
          {data ? (
            <BarList items={data.devices.map((c) => ({ label: c.device_id, value: c.meals }))} />
          ) : (
            <CardSkeleton h={200} />
          )}
        </Card>

        <Card title="By Meal Slot">
          {data ? (
            data.slots.length ? (
              <BarList color="#B93E19" items={data.slots.map((s) => ({ label: s.name, value: s.meals }))} />
            ) : (
              <Empty>No slot data.</Empty>
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

      {/* Recent punches */}
      <Card title="Recent" action={<span className="text-xs text-ink-secondary">most recent punches</span>}>
        {feed.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Device</th>
                  <th className="py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((f, i) => (
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
                    <td className="py-2.5">{f.device_id ?? "—"}</td>
                    <td className="py-2.5 text-right tnum text-ink-secondary">{timeOf(f.punched_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Waiting for punches…</Empty>
        )}
      </Card>
    </div>
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
                {(f.device_id ?? "—")} · {timeOf(f.punched_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
