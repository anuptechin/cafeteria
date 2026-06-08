import { useState } from "react";
import { api, usePoll, useCafeterias, MEAL_FILTERS, type RangeState } from "../lib/api";
import { Card, RangePicker, Avatar, CardSkeleton, Empty, Modal } from "../components/ui";
import { count, dateOf, timeOf } from "../lib/format";

export function Employees() {
  const [range, setRange] = useState<RangeState>({ key: "month", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [cafe, setCafe] = useState<number | null>(null);
  const [meal, setMeal] = useState("all");
  const mealVal = MEAL_FILTERS.find((m) => m.k === meal)!.val;
  const cafeterias = useCafeterias();
  const { data, loading } = usePoll(() => api.employees(range, q, cafe, mealVal), [range, q, cafe, mealVal], 0);
  const [openEmp, setOpenEmp] = useState<{ emp_id: string; name: string } | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">Meal consumption per employee — click anyone for a meal breakdown.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cafe ?? ""}
            onChange={(e) => setCafe(e.target.value ? Number(e.target.value) : null)}
            className="rounded-full border bg-surface-white px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-black/10"
          >
            <option value="">All cafeterias</option>
            {cafeterias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={meal}
            onChange={(e) => setMeal(e.target.value)}
            className="rounded-full border bg-surface-white px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-black/10"
          >
            {MEAL_FILTERS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
          </select>
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>

      <Card>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQ(search.trim())}
            placeholder="Search by name or employee ID…"
            className="flex-1 rounded-xl border bg-surface-bege px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <button onClick={() => setQ(search.trim())} className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-black/80">
            Search
          </button>
          {q && (
            <button onClick={() => { setSearch(""); setQ(""); }} className="rounded-xl border px-4 py-2.5 text-sm">
              Clear
            </button>
          )}
        </div>
      </Card>

      <Card
        title={q ? `Results for "${q}"` : "Top Employees"}
        action={
          data && (
            <span className="text-xs text-ink-secondary">
              {count(data.length)} shown{!q && data.length >= 120 ? " · top 120 by meals — search to find anyone" : ""}
            </span>
          )
        }
      >
        {loading && !data ? (
          <CardSkeleton h={300} />
        ) : data && data.length ? (
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-white">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 text-right font-medium">Meals</th>
                  <th className="py-2 text-right font-medium">Last Meal</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e: any) => (
                  <tr
                    key={e.emp_id}
                    onClick={() => setOpenEmp({ emp_id: e.emp_id, name: e.name })}
                    className="cursor-pointer border-b border-black/5 hover:bg-black/[0.03]"
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar empId={e.emp_id} name={e.name} imageUrl={e.image_id ? `/faces/${e.image_id}` : undefined} size={34} />
                        <div>
                          <div className="font-medium">{e.name}</div>
                          <div className="tnum text-xs text-ink-secondary">{e.emp_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-right tnum font-semibold">{count(e.meals)}</td>
                    <td className="py-2.5 text-right tnum text-ink-secondary">{e.last_seen ? timeOf(e.last_seen) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No employees found.</Empty>
        )}
      </Card>

      <EmployeeModal emp={openEmp} range={range} cafe={cafe} meal={mealVal} onClose={() => setOpenEmp(null)} />
    </div>
  );
}

const MEAL_KPIS: { k: string; tone: string }[] = [
  { k: "Lunch", tone: "#B93E19" },
  { k: "Dinner", tone: "#000000" },
  { k: "Tea", tone: "#19B924" },
  { k: "Biscuit", tone: "#B99919" },
];

function EmployeeModal({ emp, range, cafe, meal, onClose }: { emp: { emp_id: string; name: string } | null; range: RangeState; cafe: number | null; meal: string | null; onClose: () => void }) {
  const { data, loading } = usePoll(
    () => (emp ? api.employeeReport(emp.emp_id, range, cafe, meal) : Promise.resolve(null)),
    [emp?.emp_id, range, cafe, meal],
    0
  );

  return (
    <Modal open={!!emp} onClose={onClose} title={emp?.name ?? "Employee"} subtitle={emp?.emp_id} width={560}>
      {loading && !data ? (
        <CardSkeleton h={200} />
      ) : data ? (
        <div className="space-y-4">
          {/* Per-meal KPI numbers (scoped to the selected cafeteria) — the active
              meal filter is highlighted. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MEAL_KPIS.map((m) => {
              const active = meal === m.k;
              return (
                <div key={m.k} className={`relative overflow-hidden rounded-xl border p-3 ${active ? "bg-black text-white ring-2 ring-black" : "bg-surface-bege"}`}>
                  <div className="absolute left-0 top-0 h-full w-1" style={{ background: m.tone }} />
                  <div className={`text-xs ${active ? "text-white/70" : "text-ink-secondary"}`}>{m.k}</div>
                  <div className="tnum text-2xl font-bold">{count(data.kpi?.[m.k] ?? 0)}</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between rounded-xl bg-black/[0.03] px-4 py-2.5 text-sm">
            <span className="text-ink-secondary">{meal ? `${meal} meals in view` : "Total meals in period"}</span>
            <span className="tnum text-lg font-bold">{count(data.totalMeals)}</span>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-white">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Meal</th>
                  <th className="px-3 py-2 font-medium">Cafeteria · Device</th>
                </tr>
              </thead>
              <tbody>
                {data.punches.map((p: any) => (
                  <tr key={p.id} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-2">{dateOf(p.punched_at)}</td>
                    <td className="px-3 py-2 tnum">{timeOf(p.punched_at)}</td>
                    <td className="px-3 py-2">{p.meal ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{(p.cafeteria_name ? p.cafeteria_name + " · " : "") + (p.device_id ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.punches.length && <Empty>No meals in this period.</Empty>}
          </div>
        </div>
      ) : (
        <Empty>Couldn't load this employee.</Empty>
      )}
    </Modal>
  );
}
