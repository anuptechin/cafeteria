import { useEffect, useState } from "react";
import { api, usePoll, useCafeterias, MEAL_FILTERS, type RangeState } from "../lib/api";
import { Card, RangePicker, Avatar, CardSkeleton, Empty } from "../components/ui";
import { count, dateOf, timeOf } from "../lib/format";

type Tab = "device" | "employees" | "lookup";

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Reusable little dropdown for the filter bar.
function FilterSelect({ value, onChange, children }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border bg-surface-white px-3 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-black/10"
    >
      {children}
    </select>
  );
}

const deviceLabel = (r: { device_id: string; meal: string | null }) =>
  r.meal ? `${r.device_id} (${r.meal})` : r.device_id;

export function Reports() {
  const [tab, setTab] = useState<Tab>("device");
  const [range, setRange] = useState<RangeState>({ key: "month", from: "", to: "" });
  const [cafe, setCafe] = useState<number | null>(null);
  const cafeterias = useCafeterias();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">Meal-count records for audit & dispute reference.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={cafe ?? ""} onChange={(v) => setCafe(v ? Number(v) : null)}>
            <option value="">All cafeterias</option>
            {cafeterias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FilterSelect>
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>

      <div className="inline-flex rounded-full border bg-surface-white p-0.5">
        {([["device", "Device-wise"], ["employees", "By Employee"], ["lookup", "Employee Lookup"]] as [Tab, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === k ? "bg-black text-white" : "text-ink-secondary hover:text-black"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "device" && <DeviceReport range={range} cafe={cafe} onCSV={downloadCSV} />}
      {tab === "employees" && <EmployeesReport range={range} cafe={cafe} onCSV={downloadCSV} />}
      {tab === "lookup" && <EmployeeLookup range={range} cafe={cafe} cafeterias={cafeterias} />}
    </div>
  );
}

function DeviceReport({ range, cafe, onCSV }: { range: RangeState; cafe: number | null; onCSV: typeof downloadCSV }) {
  const { data } = usePoll(() => api.deviceReport(range, cafe), [range, cafe], 0);
  if (!data) return <CardSkeleton h={300} />;
  return (
    <Card
      title="Device-wise Meals"
      action={
        <button
          onClick={() =>
            onCSV(`device_${range.key}.csv`, [
              ["Device", "Meal", "Meals"],
              ...data.rows.map((r: any) => [r.device_id, r.meal ?? "—", r.meals]),
              ["TOTAL", "", data.totalMeals],
            ])
          }
          className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80"
        >
          Export CSV
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Total Meals" value={count(data.totalMeals)} />
        <Kpi label="Device + Meal rows" value={count(data.rows.length)} />
        <Kpi label="Busiest" value={data.rows[0] ? deviceLabel(data.rows[0]) : "—"} small />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
            <th className="py-2 font-medium">Device (Meal)</th>
            <th className="py-2 text-right font-medium">Meals</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={`${r.device_id}-${r.meal ?? "none"}`} className="border-b border-black/5 hover:bg-black/[0.02]">
              <td className="py-2.5 font-medium">
                {r.device_id}
                {r.meal && <span className="ml-1.5 rounded bg-black/5 px-1.5 py-0.5 text-xs font-semibold text-ink-secondary">{r.meal}</span>}
              </td>
              <td className="py-2.5 text-right tnum font-semibold">{count(r.meals)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-3">Total</td>
            <td className="py-3 text-right tnum">{count(data.totalMeals)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function EmployeesReport({ range, cafe, onCSV }: { range: RangeState; cafe: number | null; onCSV: typeof downloadCSV }) {
  const [meal, setMeal] = useState("all");
  const mealVal = MEAL_FILTERS.find((m) => m.k === meal)!.val;
  const { data } = usePoll(() => api.employeesReport(range, cafe, mealVal), [range, cafe, mealVal], 0);
  const [q, setQ] = useState("");
  if (!data) return <CardSkeleton h={300} />;

  const term = q.trim().toLowerCase();
  const filtered = term
    ? data.rows.filter((r: any) => r.name.toLowerCase().includes(term) || String(r.emp_id).includes(term))
    : data.rows;
  const CAP = 200;
  const shown = filtered.slice(0, CAP);

  return (
    <Card
      title="Meals by Employee (Audit)"
      action={
        <div className="flex items-center gap-2">
          <FilterSelect value={meal} onChange={setMeal}>
            {MEAL_FILTERS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
          </FilterSelect>
          <button
            onClick={() =>
              onCSV(`employee_meals_${range.key}_${meal}.csv`, [
                ["Emp ID", "Name", "Meals"],
                ...data.rows.map((r: any) => [r.emp_id, r.name, r.meals]),
                ["", "TOTAL", data.totalMeals],
              ])
            }
            className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80"
          >
            Export CSV (all)
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Employees" value={count(data.rows.length)} />
        <Kpi label={meal === "all" ? "Total Meals" : `${meal} Meals`} value={count(data.totalMeals)} />
        <Kpi label="Showing" value={`${count(shown.length)} of ${count(filtered.length)}`} small />
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by name or ID…"
        className="mb-3 w-full rounded-xl border bg-surface-bege px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
      />
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-white">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
              <th className="py-2 font-medium">Employee</th>
              <th className="py-2 text-right font-medium">Meals</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r: any) => (
              <tr key={r.emp_id} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar empId={r.emp_id} name={r.name} imageUrl={r.image_id ? `/faces/${r.image_id}` : undefined} size={30} />
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="tnum text-xs text-ink-secondary">{r.emp_id}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2 text-right tnum font-medium">{count(r.meals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > CAP && (
          <div className="py-3 text-center text-xs text-ink-secondary">
            Showing top {CAP}. Use the filter to narrow, or Export CSV for the full list.
          </div>
        )}
      </div>
    </Card>
  );
}

function EmployeeLookup({ range, cafe, cafeterias }: { range: RangeState; cafe: number | null; cafeterias: { id: number; name: string }[] }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const { data, error, loading } = usePoll(
    () => (selected ? api.employeeReport(selected, range, cafe) : Promise.resolve(null)),
    [selected, range, cafe],
    0
  );

  // search by name OR id (debounced), scoped to the selected cafeteria
  useEffect(() => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.employees(range, term.trim(), cafe).then((r) => setResults(r.slice(0, 8))).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [term, range, cafe]);

  const choose = (r: any) => {
    setSelected(r.emp_id);
    setTerm(r.name);
    setResults([]);
  };
  const onEnter = () => {
    if (results[0]) choose(results[0]);
    else if (term.trim()) setSelected(term.trim());
  };

  const cafeName = cafeterias.find((c) => c.id === cafe)?.name;

  return (
    <div className="space-y-4">
      <Card>
        <div className="relative">
          <input
            value={term}
            onChange={(e) => { setTerm(e.target.value); setSelected(""); }}
            onKeyDown={(e) => e.key === "Enter" && onEnter()}
            placeholder={`Search by name or employee ID${cafeName ? ` · ${cafeName}` : ""}…`}
            className="w-full rounded-xl border bg-surface-bege px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-surface-white shadow-pop">
              {results.map((r) => (
                <button
                  key={r.emp_id}
                  onClick={() => choose(r)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-black/5"
                >
                  <Avatar empId={r.emp_id} name={r.name} imageUrl={r.image_id ? `/faces/${r.image_id}` : undefined} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="tnum truncate text-xs text-ink-secondary">{r.emp_id}</div>
                  </div>
                  <span className="ml-auto shrink-0 tnum text-xs text-ink-secondary">{count(r.meals)} meals</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {selected && loading && <CardSkeleton h={200} />}
      {error && <Card className="border-error/30 bg-error/5"><span className="text-sm text-error">{error}</span></Card>}
      {data && <EmployeeDetail data={data} />}
    </div>
  );
}

const MEAL_KPIS: { k: string; tone: string }[] = [
  { k: "Lunch", tone: "#B93E19" },
  { k: "Dinner", tone: "#000000" },
  { k: "Tea", tone: "#19B924" },
  { k: "Biscuit", tone: "#B99919" },
];

function EmployeeDetail({ data }: { data: any }) {
  return (
    <Card>
      <div className="mb-5 flex items-center gap-4">
        <Avatar empId={data.emp.emp_id} name={data.emp.name} imageUrl={data.emp.image_id ? `/faces/${data.emp.image_id}` : undefined} size={56} />
        <div>
          <div className="text-xl font-bold">{data.emp.name}</div>
          <div className="text-sm text-ink-secondary"><span className="tnum">{data.emp.emp_id}</span></div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-ink-secondary">Total Meals</div>
          <div className="tnum text-3xl font-bold">{count(data.totalMeals)}</div>
        </div>
      </div>

      {/* Per-meal KPI numbers */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MEAL_KPIS.map((m) => (
          <div key={m.k} className="relative overflow-hidden rounded-xl border bg-surface-bege p-3">
            <div className="absolute left-0 top-0 h-full w-1" style={{ background: m.tone }} />
            <div className="text-xs text-ink-secondary">{m.k}</div>
            <div className="tnum text-2xl font-bold">{count(data.kpi?.[m.k] ?? 0)}</div>
          </div>
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-white">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Time</th>
              <th className="py-2 font-medium">Meal</th>
              <th className="py-2 font-medium">Cafeteria · Device</th>
            </tr>
          </thead>
          <tbody>
            {data.punches.map((p: any) => (
              <tr key={p.id} className="border-b border-black/5">
                <td className="py-2">{dateOf(p.punched_at)}</td>
                <td className="py-2 tnum">{timeOf(p.punched_at)}</td>
                <td className="py-2">{p.meal ?? "—"}</td>
                <td className="py-2 text-ink-secondary">{(p.cafeteria_name ? p.cafeteria_name + " · " : "") + (p.device_id ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.punches.length && <Empty>No meals in this period.</Empty>}
      </div>
    </Card>
  );
}

function Kpi({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border bg-surface-bege p-3">
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className={`font-bold ${small ? "text-base" : "tnum text-lg"}`}>{value}</div>
    </div>
  );
}
