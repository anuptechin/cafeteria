import { useState } from "react";
import { api, usePoll, type RangeState } from "../lib/api";
import { Card, RangePicker, Avatar, CardSkeleton, Empty } from "../components/ui";
import { count, timeOf } from "../lib/format";

export function Employees() {
  const [range, setRange] = useState<RangeState>({ key: "60d", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const { data, loading } = usePoll(() => api.employees(range, q), [range, q], 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">Meal consumption per employee — for audit and dispute reference.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
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

      <Card title={q ? `Results for "${q}"` : "All Employees"} action={data && <span className="text-xs text-ink-secondary">{count(data.length)} shown</span>}>
        {loading && !data ? (
          <CardSkeleton h={300} />
        ) : data && data.length ? (
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-white">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Department</th>
                  <th className="py-2 text-right font-medium">Meals</th>
                  <th className="py-2 text-right font-medium">Last Meal</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e: any) => (
                  <tr key={e.emp_id} className="border-b border-black/5 hover:bg-black/[0.02]">
                    <td className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar empId={e.emp_id} name={e.name} size={34} />
                        <div>
                          <div className="font-medium">{e.name}</div>
                          <div className="tnum text-xs text-ink-secondary">{e.emp_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-ink-secondary">{e.department}</td>
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
    </div>
  );
}
