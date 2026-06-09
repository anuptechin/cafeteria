import { useEffect, useState } from "react";
import { api, usePoll, useCafeterias, MEAL_FILTERS, type RangeState } from "../lib/api";
import { Card, RangePicker, Avatar, CardSkeleton, Empty } from "../components/ui";
import { count, dateOf, timeOf, dayLabel } from "../lib/format";
import { costOf, addCost, rupee, ZERO_COST, type MealCost } from "../lib/pricing";
import { MultiLineChart } from "../components/charts";
import { EmployeeModal } from "./Employees";

// Meal lines for the settlement trend chart — colours match the app's meal tones.
const MEAL_LINES = [
  { key: "lunch", name: "Lunch", color: "#B93E19" },
  { key: "dinner", name: "Dinner", color: "#000000" },
  { key: "tea", name: "Tea", color: "#19B924" },
  { key: "biscuit", name: "Biscuit", color: "#2563EB" },
] as const;

type Tab = "device" | "employees" | "lookup" | "daily";
type ExportKind = "month" | "lastmonth" | "custom";

// Single "Export Report" dropdown — PDF and Excel, each for This Month / Last Month
// / Custom (current filter). Options read e.g. "PDF (This Month)", "Excel (Custom)".
function ExportMenu({ busy, onPick }: { busy?: boolean; onPick: (fmt: "pdf" | "excel", k: ExportKind) => void }) {
  const [open, setOpen] = useState(false);
  const groups: { fmt: "pdf" | "excel"; label: string }[] = [
    { fmt: "pdf", label: "PDF" },
    { fmt: "excel", label: "Excel" },
  ];
  const kinds: [ExportKind, string][] = [
    ["month", "This Month"],
    ["lastmonth", "Last Month"],
    ["custom", "Custom"],
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-black/85 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
        {busy ? "Preparing…" : "Export Report"}
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border bg-surface-white py-1 shadow-pop">
            {groups.map((g, gi) => (
              <div key={g.fmt} className={gi > 0 ? "mt-1 border-t pt-1" : ""}>
                <div className="px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-ink-secondary">{g.label}</div>
                {kinds.map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => { setOpen(false); onPick(g.fmt, k); }}
                    className="block w-full px-4 py-1.5 text-left text-xs font-medium text-ink hover:bg-black/5"
                  >
                    {g.label} ({l})
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

export function Reports() {
  const [tab, setTab] = useState<Tab>("daily");
  const [range, setRange] = useState<RangeState>({ key: "month", from: "", to: "" });
  const [cafe, setCafe] = useState<number | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfRange, setPdfRange] = useState<RangeState>({ key: "month", from: "", to: "" });
  const [busyXlsx, setBusyXlsx] = useState(false);
  const cafeterias = useCafeterias();
  const cafeName = cafeterias.find((c) => c.id === cafe)?.name ?? null;

  // "Custom" uses whatever the page's RangePicker holds; presets are explicit.
  const rangeFor = (kind: ExportKind): RangeState =>
    kind === "custom" ? range : { key: kind, from: "", to: "" };
  const openPdf = (kind: ExportKind) => { setPdfRange(rangeFor(kind)); setPdfOpen(true); };
  const downloadXlsx = async (kind: ExportKind) => {
    setBusyXlsx(true);
    try { await api.downloadXlsx(rangeFor(kind), cafe); }
    catch (e) { alert((e as Error).message || "Export failed"); }
    finally { setBusyXlsx(false); }
  };

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
          <ExportMenu busy={busyXlsx} onPick={(fmt, kind) => (fmt === "pdf" ? openPdf(kind) : downloadXlsx(kind))} />
        </div>
      </header>

      {pdfOpen && <SettlementDoc range={pdfRange} cafe={cafe} cafeName={cafeName} onClose={() => setPdfOpen(false)} />}

      <div className="inline-flex rounded-full border bg-surface-white p-0.5">
        {([["daily", "Date-wise"], ["device", "Location-wise"], ["employees", "By Employee"], ["lookup", "Employee Lookup"]] as [Tab, string][]).map(([k, l]) => (
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
      {tab === "daily" && <DailyReport range={range} cafe={cafe} onCSV={downloadCSV} />}
    </div>
  );
}

function DeviceReport({ range, cafe, onCSV }: { range: RangeState; cafe: number | null; onCSV: typeof downloadCSV }) {
  const { data } = usePoll(() => api.deviceReport(range, cafe), [range, cafe], 0);
  if (!data) return <CardSkeleton h={300} />;
  const totalCost: MealCost = data.rows.reduce((a: MealCost, r: any) => addCost(a, costOf(r.emp_paid, r.company_paid)), ZERO_COST);
  return (
    <Card
      title="Location-wise Meals & Cost"
      action={
        <button
          onClick={() =>
            onCSV(`location_${range.key}.csv`, [
              ["Location", "Meal", "Total Count", "Employee Paid", "Company Paid", "Total (Vendor)"],
              ...data.rows.map((r: any) => {
                const c = costOf(r.emp_paid, r.company_paid);
                return [r.cafeteria_name, r.meal ?? "—", r.meals, c.emp, c.co, c.vendor];
              }),
              ["TOTAL", "", data.totalMeals, totalCost.emp, totalCost.co, totalCost.vendor],
            ])
          }
          className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80"
        >
          Export CSV
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Meals" value={count(data.totalMeals)} />
        <Kpi label="Employee Paid" value={rupee(totalCost.emp)} small />
        <Kpi label="Company Paid" value={rupee(totalCost.co)} small />
        <Kpi label="Total (Vendor)" value={rupee(totalCost.vendor)} small />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
              <th className="py-2 font-medium">Location (Meal)</th>
              <th className="py-2 text-right font-medium">Total Count</th>
              <th className="py-2 text-right font-medium">Employee Paid</th>
              <th className="py-2 text-right font-medium">Company Paid</th>
              <th className="py-2 text-right font-medium">Total (Vendor)</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => {
              const c = costOf(r.emp_paid, r.company_paid);
              return (
                <tr key={`${r.cafeteria_name}-${r.meal ?? "none"}`} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="py-2.5 font-medium">
                    {r.cafeteria_name}
                    {r.meal && <span className="ml-1.5 rounded bg-black/5 px-1.5 py-0.5 text-xs font-semibold text-ink-secondary">{r.meal}</span>}
                  </td>
                  <td className="py-2.5 text-right tnum font-semibold">{count(r.meals)}</td>
                  <td className="py-2.5 text-right tnum text-ink-secondary">{rupee(c.emp)}</td>
                  <td className="py-2.5 text-right tnum text-ink-secondary">{rupee(c.co)}</td>
                  <td className="py-2.5 text-right tnum font-semibold">{rupee(c.vendor)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="py-3">Total</td>
              <td className="py-3 text-right tnum">{count(data.totalMeals)}</td>
              <td className="py-3 text-right tnum">{rupee(totalCost.emp)}</td>
              <td className="py-3 text-right tnum">{rupee(totalCost.co)}</td>
              <td className="py-3 text-right tnum">{rupee(totalCost.vendor)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EmployeesReport({ range, cafe, onCSV }: { range: RangeState; cafe: number | null; onCSV: typeof downloadCSV }) {
  const [meal, setMeal] = useState("all");
  const mealVal = MEAL_FILTERS.find((m) => m.k === meal)!.val;
  const { data } = usePoll(() => api.employeesReport(range, cafe, mealVal), [range, cafe, mealVal], 0);
  const [q, setQ] = useState("");
  const [openEmp, setOpenEmp] = useState<{ emp_id: string; name: string } | null>(null);
  if (!data) return <CardSkeleton h={300} />;

  const term = q.trim().toLowerCase();
  const filtered = term
    ? data.rows.filter((r: any) => r.name.toLowerCase().includes(term) || String(r.emp_id).includes(term))
    : data.rows;
  const CAP = 200;
  const shown = filtered.slice(0, CAP);
  const totalCost: MealCost = data.rows.reduce((a: MealCost, r: any) => addCost(a, costOf(r.emp_paid, r.company_paid)), ZERO_COST);

  return (
    <>
    <Card
      title="Meals & Cost by Employee (Audit)"
      action={
        <div className="flex items-center gap-2">
          <FilterSelect value={meal} onChange={setMeal}>
            {MEAL_FILTERS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
          </FilterSelect>
          <button
            onClick={() =>
              onCSV(`employee_meals_${range.key}_${meal}.csv`, [
                ["Emp ID", "Name", "Meals", "Employee Paid", "Company Paid", "Total (Vendor)"],
                ...data.rows.map((r: any) => {
                  const c = costOf(r.emp_paid, r.company_paid);
                  return [r.emp_id, r.name, r.meals, c.emp, c.co, c.vendor];
                }),
                ["", "TOTAL", data.totalMeals, totalCost.emp, totalCost.co, totalCost.vendor],
              ])
            }
            className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80"
          >
            Export CSV (all)
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Employees" value={count(data.rows.length)} />
        <Kpi label={meal === "all" ? "Total Meals" : `${meal} Meals`} value={count(data.totalMeals)} />
        <Kpi label="Showing" value={`${count(shown.length)} of ${count(filtered.length)}`} small />
        <Kpi label="Employee Paid" value={rupee(totalCost.emp)} small />
        <Kpi label="Company Paid" value={rupee(totalCost.co)} small />
        <Kpi label="Total (Vendor)" value={rupee(totalCost.vendor)} small />
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by name or ID…"
        className="mb-3 w-full rounded-xl border bg-surface-bege px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
      />
      <div className="max-h-[520px] overflow-x-auto overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-white">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
              <th className="py-2 font-medium">Employee</th>
              <th className="py-2 text-right font-medium">Meals</th>
              <th className="py-2 text-right font-medium">Employee Paid</th>
              <th className="py-2 text-right font-medium">Company Paid</th>
              <th className="py-2 text-right font-medium">Total (Vendor)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r: any) => {
              const c = costOf(r.emp_paid, r.company_paid);
              return (
                <tr
                  key={r.emp_id}
                  onClick={() => setOpenEmp({ emp_id: r.emp_id, name: r.name })}
                  className="cursor-pointer border-b border-black/5 hover:bg-black/[0.02]"
                >
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
                  <td className="py-2 text-right tnum text-ink-secondary">{rupee(c.emp)}</td>
                  <td className="py-2 text-right tnum text-ink-secondary">{rupee(c.co)}</td>
                  <td className="py-2 text-right tnum font-semibold">{rupee(c.vendor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > CAP && (
          <div className="py-3 text-center text-xs text-ink-secondary">
            Showing top {CAP}. Use the filter to narrow, or Export CSV for the full list.
          </div>
        )}
      </div>
    </Card>
    <EmployeeModal emp={openEmp} range={range} cafe={cafe} meal={mealVal} onClose={() => setOpenEmp(null)} />
    </>
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
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MEAL_KPIS.map((m) => (
          <div key={m.k} className="relative overflow-hidden rounded-xl border bg-surface-bege p-3">
            <div className="absolute left-0 top-0 h-full w-1" style={{ background: m.tone }} />
            <div className="text-xs text-ink-secondary">{m.k}</div>
            <div className="tnum text-2xl font-bold">{count(data.kpi?.[m.k] ?? 0)}</div>
          </div>
        ))}
      </div>

      {/* Cost — Employee Paid / Company Paid / Total (Vendor). Summed server-side
          using each punch's day-correct, per-cafeteria rate. */}
      {(() => {
        const c = costOf(data.cost?.emp_paid, data.cost?.company_paid);
        const tiles: [string, number][] = [["Employee Paid", c.emp], ["Company Paid", c.co], ["Total (Vendor)", c.vendor]];
        return (
          <div className="mb-5 grid grid-cols-3 gap-3">
            {tiles.map(([label, val], i) => (
              <div key={label} className={`rounded-xl border p-3 ${i === 2 ? "bg-black text-white" : "bg-surface-white"}`}>
                <div className={`text-xs ${i === 2 ? "text-white/70" : "text-ink-secondary"}`}>{label}</div>
                <div className="tnum text-xl font-bold">{rupee(val)}</div>
              </div>
            ))}
          </div>
        );
      })()}

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

function DailyReport({ range, cafe, onCSV }: { range: RangeState; cafe: number | null; onCSV: typeof downloadCSV }) {
  const [meal, setMeal] = useState("all");
  const { data } = usePoll(() => api.dailyReport(range, cafe), [range, cafe], 0);
  if (!data) return <CardSkeleton h={300} />;

  // Latest day first reads better as a report.
  const rows: any[] = [...data.rows].reverse();
  // The four meal columns; the meal filter narrows to just one.
  const ALL = [
    { key: "lunch", label: "Lunch" },
    { key: "dinner", label: "Dinner" },
    { key: "tea", label: "Tea" },
    { key: "biscuit", label: "Biscuit" },
  ];
  const cols = meal === "all" ? ALL : ALL.filter((c) => c.label === meal);
  const rowTotal = (r: any) => cols.reduce((a, c) => a + (r[c.key] ?? 0), 0);
  const colTotal = (key: string) => rows.reduce((a, r) => a + (r[key] ?? 0), 0);
  const grandTotal = rows.reduce((a, r) => a + rowTotal(r), 0);
  const busiestDay = rows.length ? dayLabel(rows.reduce((a, r) => (rowTotal(r) > rowTotal(a) ? r : a), rows[0]).d) : "—";

  return (
    <Card
      title="Date-wise Meals"
      action={
        <div className="flex items-center gap-2">
          <FilterSelect value={meal} onChange={setMeal}>
            {MEAL_FILTERS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
          </FilterSelect>
          <button
            onClick={() =>
              onCSV(`daily_${range.key}_${meal}.csv`, [
                ["Date", ...cols.map((c) => c.label), "Total"],
                ...rows.map((r) => [r.d, ...cols.map((c) => r[c.key] ?? 0), rowTotal(r)]),
                ["TOTAL", ...cols.map((c) => colTotal(c.key)), grandTotal],
              ])
            }
            className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80"
          >
            Export CSV
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Days" value={count(rows.length)} />
        <Kpi label={meal === "all" ? "Total Meals" : `${meal} Meals`} value={count(grandTotal)} />
        <Kpi label="Busiest Day" value={busiestDay} small />
        <Kpi label="Avg / Day" value={count(rows.length ? Math.round(grandTotal / rows.length) : 0)} />
      </div>
      {rows.length ? (
        <div className="max-h-[520px] overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-white">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                <th className="py-2 font-medium">Date</th>
                {cols.map((c) => <th key={c.key} className="py-2 text-right font-medium">{c.label}</th>)}
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.d} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="py-2.5 font-medium">{dayLabel(r.d)}</td>
                  {cols.map((c) => <td key={c.key} className="py-2.5 text-right tnum text-ink-secondary">{count(r[c.key] ?? 0)}</td>)}
                  <td className="py-2.5 text-right tnum font-semibold">{count(rowTotal(r))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-3">Total</td>
                {cols.map((c) => <td key={c.key} className="py-3 text-right tnum">{count(colTotal(c.key))}</td>)}
                <td className="py-3 text-right tnum">{count(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No meals in this period.</Empty>
      )}
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

// ====================== Vendor/Company Settlement PDF ======================
// Full-screen branded statement, one section per cafeteria (page-break between
// them), each with a 4-line day-wise trend + a day-wise count/₹ table + rate card.
// "Print / Save as PDF" uses the browser's print engine (vector, crisp, instant);
// the @media print rules in index.css isolate #print-area and page-break sections.
function SettlementDoc({
  range, cafe, cafeName, onClose,
}: { range: RangeState; cafe: number | null; cafeName: string | null; onClose: () => void }) {
  const { data, loading, error } = usePoll(() => api.settlementReport(range, cafe), [range, cafe], 0);

  const period = data ? `${dateOf(data.from)} — ${dateOf(data.to)}` : "";
  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const stmtNo = data ? `CS-${String(data.from).slice(0, 10).replace(/-/g, "")}-${String(data.to).slice(0, 10).replace(/-/g, "")}` : "";

  return (
    <div id="print-area" className="fixed inset-0 z-[60] overflow-auto bg-surface-bege">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-surface-white/95 px-5 py-3 backdrop-blur">
        <div className="text-sm font-semibold">Settlement statement — preview</div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} disabled={!data} className="rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white hover:bg-black/85 disabled:opacity-40">
            Print / Save as PDF
          </button>
          <button onClick={onClose} className="rounded-full border px-4 py-1.5 text-xs font-semibold hover:bg-black/5">Close</button>
        </div>
      </div>

      <div className="mx-auto my-6 max-w-[820px] bg-surface-white px-10 py-9 shadow-card print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        {loading && !data ? (
          <CardSkeleton h={420} />
        ) : error ? (
          <div className="text-sm text-error">Couldn't load the statement: {error}</div>
        ) : data ? (
          <>
            {/* Header */}
            <div className="flex items-start justify-between border-b pb-5">
              <img src="/ddecor-logo.webp" alt="D'DECOR" className="h-20 w-auto object-contain" />
              <div className="text-right">
                <div className="text-2xl font-extrabold leading-none tracking-tight">Cafeteria Settlement</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink-secondary">Statement</div>
                <div className="mt-1.5 text-xs text-ink-secondary">{period}</div>
                <div className="text-xs text-ink-secondary">{cafeName ?? "All cafeterias"} · {stmtNo}</div>
              </div>
            </div>

            {/* Grand summary */}
            <div className="mt-5 grid grid-cols-4 gap-3 print-avoid">
              <SumTile label="Total Meals" value={count(data.grand.meals)} />
              <SumTile label="Employee Paid" value={rupee(data.grand.emp_paid)} />
              <SumTile label="Company Paid" value={rupee(data.grand.company_paid)} />
              <SumTile label="Vendor Payable" value={rupee(data.grand.vendor)} accent />
            </div>

            {!data.cafeterias.length && <div className="mt-8"><Empty>No meals in this period.</Empty></div>}

            {data.cafeterias.map((c: any, i: number) => (
              <CafeSection key={c.id} c={c} first={i === 0} period={period} />
            ))}

            {/* On-screen closing note (hidden in print — replaced by the running footer). */}
            <div className="mt-8 border-t pt-3 text-[10px] leading-relaxed text-ink-secondary print:hidden">
              System-generated on {generatedAt}. <strong>Vendor Payable = Employee Paid + Company Paid.</strong> Amounts use the
              meal rate effective on each day; meal counts follow each cafeteria's de-duplication rules. This is a
              reconciliation document — no signature required.
            </div>

            {/* Print-only running footer — fixed in the page's bottom margin, so it
                never pushes content onto an extra page and repeats on every sheet. */}
            <div className="print-running-footer hidden print:block">
              Vendor Payable = Employee Paid + Company Paid · Generated {generatedAt} · D'Decor Cafeteria Management — reconciliation document, no signature required.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CafeSection({ c, first, period }: { c: any; first: boolean; period: string }) {
  const labels: string[] = c.days.map((d: any) => dayLabel(d.d));
  const series = MEAL_LINES.map((m) => ({ name: m.name, color: m.color, values: c.days.map((d: any) => d[m.key] as number) }));

  return (
    <section className={`mt-8 ${first ? "" : "print-page"}`}>
      <div className="flex items-end justify-between border-b border-black/10 pb-2">
        <div>
          <div className="text-base font-bold tracking-tight">{c.name}</div>
          <div className="text-[11px] text-ink-secondary">{period} · {count(c.totals.meals)} meals</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-ink-secondary">Vendor Payable</div>
          <div className="tnum text-lg font-bold">{rupee(c.totals.vendor)}</div>
        </div>
      </div>

      {/* Day-wise 4-line trend */}
      <div className="print-avoid mt-4 rounded-xl border bg-surface-white p-4">
        <div className="mb-2 text-xs font-semibold text-ink-secondary">Day-wise consumption trend</div>
        {c.days.length ? <MultiLineChart labels={labels} series={series} height={190} /> : <Empty>No daily data.</Empty>}
      </div>

      {/* Per-meal counts */}
      <div className="mt-4 grid grid-cols-4 gap-3 print-avoid">
        {MEAL_LINES.map((m) => (
          <SumTile key={m.key} small dot={m.color} label={m.name} value={count(c.totals[m.key])} />
        ))}
      </div>

      {/* Money split */}
      <div className="mt-3 grid grid-cols-3 gap-3 print-avoid">
        <SumTile small label="Employee Paid" value={rupee(c.totals.emp_paid)} />
        <SumTile small label="Company Paid" value={rupee(c.totals.company_paid)} />
        <SumTile small label="Vendor Payable" value={rupee(c.totals.vendor)} accent />
      </div>

      {/* Day-wise table — counts + ₹ */}
      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="border-b text-left uppercase tracking-wide text-ink-secondary">
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 text-right font-medium">Lunch</th>
            <th className="py-2 text-right font-medium">Dinner</th>
            <th className="py-2 text-right font-medium">Tea</th>
            <th className="py-2 text-right font-medium">Biscuit</th>
            <th className="py-2 text-right font-medium">Total</th>
            <th className="py-2 text-right font-medium">Vendor ₹</th>
          </tr>
        </thead>
        <tbody>
          {c.days.map((d: any) => (
            <tr key={d.d} className="border-b border-black/5">
              <td className="py-1.5 font-medium">{dayLabel(d.d)}</td>
              <td className="py-1.5 text-right tnum">{count(d.lunch)}</td>
              <td className="py-1.5 text-right tnum">{count(d.dinner)}</td>
              <td className="py-1.5 text-right tnum">{count(d.tea)}</td>
              <td className="py-1.5 text-right tnum">{count(d.biscuit)}</td>
              <td className="py-1.5 text-right tnum font-semibold">{count(d.total)}</td>
              <td className="py-1.5 text-right tnum">{rupee(d.vendor)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right tnum">{count(c.totals.lunch)}</td>
            <td className="py-2 text-right tnum">{count(c.totals.dinner)}</td>
            <td className="py-2 text-right tnum">{count(c.totals.tea)}</td>
            <td className="py-2 text-right tnum">{count(c.totals.biscuit)}</td>
            <td className="py-2 text-right tnum">{count(c.totals.meals)}</td>
            <td className="py-2 text-right tnum">{rupee(c.totals.vendor)}</td>
          </tr>
        </tbody>
      </table>

      {/* Rate card */}
      {c.rates?.length > 0 && (
        <div className="print-avoid mt-5">
          <div className="mb-1.5 text-[11px] font-semibold text-ink-secondary">Rate card applied (₹ per meal · current)</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left uppercase tracking-wide text-ink-secondary">
                <th className="py-1.5 font-medium">Meal</th>
                <th className="py-1.5 text-right font-medium">Employee</th>
                <th className="py-1.5 text-right font-medium">Company</th>
                <th className="py-1.5 text-right font-medium">Vendor</th>
              </tr>
            </thead>
            <tbody>
              {["Lunch", "Dinner", "Tea", "Biscuit"].map((m) => {
                const r = c.rates.find((x: any) => x.meal === m);
                const emp = r?.emp_paid ?? 0, co = r?.company_paid ?? 0;
                return (
                  <tr key={m} className="border-b border-black/5">
                    <td className="py-1.5">{m}</td>
                    <td className="py-1.5 text-right tnum">{rupee(emp)}</td>
                    <td className="py-1.5 text-right tnum">{rupee(co)}</td>
                    <td className="py-1.5 text-right tnum font-semibold">{rupee(emp + co)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SumTile({ label, value, accent, small, dot }: { label: string; value: string; accent?: boolean; small?: boolean; dot?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "bg-black text-white" : "bg-surface-bege"}`}>
      <div className={`flex items-center gap-1.5 text-[11px] ${accent ? "text-white/70" : "text-ink-secondary"}`}>
        {dot && <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
      <div className={`tnum font-bold ${small ? "text-base" : "text-xl"}`}>{value}</div>
    </div>
  );
}
