import { useEffect, useRef, useState } from "react";
import { api, usePoll, useCafeterias, MEAL_FILTERS, type RangeState } from "../lib/api";
import { Card, RangePicker, Avatar, CardSkeleton, Empty, Modal } from "../components/ui";
import { count, dateOf, timeOf, rangeLabel } from "../lib/format";
import { useAuth } from "../lib/auth";
import { FaceFill } from "../components/avatar";

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
                        <Avatar
                          empId={e.emp_id}
                          name={e.name}
                          imageUrl={e.has_photo ? `/faces/emp/${encodeURIComponent(e.emp_id)}` : e.image_id ? `/faces/${e.image_id}` : undefined}
                          size={34}
                        />
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

// Resize an uploaded photo to ≤900px JPEG before sending — keeps the DB lean
// and uploads fast even when someone picks a 12MP phone shot.
async function downscalePhoto(file: File, max = 900): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // PNG transparency → white, not black, after JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not read that image — try a JPEG or PNG");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MEAL_KPIS: { k: string; tone: string }[] = [
  { k: "Lunch", tone: "#B93E19" },
  { k: "Dinner", tone: "#000000" },
  { k: "Tea", tone: "#19B924" },
  { k: "Biscuit", tone: "#B99919" },
];
const MEAL_TONE: Record<string, string> = Object.fromEntries(MEAL_KPIS.map((m) => [m.k, m.tone]));

export function EmployeeModal({ emp, range, cafe, meal, onClose }: { emp: { emp_id: string; name: string } | null; range: RangeState; cafe: number | null; meal: string | null; onClose: () => void }) {
  const { data, loading } = usePoll(
    () => (emp ? api.employeeReport(emp.emp_id, range, cafe, meal) : Promise.resolve(null)),
    [emp?.emp_id, range, cafe, meal],
    0
  );
  const cafeterias = useCafeterias();
  const [exporting, setExporting] = useState(false);
  const { can } = useAuth();
  const canManagePhoto = can("super_admin", "admin");
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Local override after an upload/remove (server truth is data.emp). Source:
  // "uploaded" portrait > "camera" capture > "none". `ver` busts the img cache.
  const [photo, setPhoto] = useState<{ src: "uploaded" | "camera" | "none"; ver: number } | null>(null);
  useEffect(() => setPhoto(null), [emp?.emp_id]);

  // Pre-warm the heavy jsPDF chunk while the user is looking at the modal so
  // the export click only has to render the document.
  useEffect(() => {
    if (emp) void import("../lib/employeePdf");
  }, [emp]);

  // What the avatar currently shows: an admin upload, a camera capture, or nothing.
  const photoSrc: "uploaded" | "camera" | "none" =
    photo?.src ?? (data?.emp?.has_photo ? "uploaded" : data?.emp?.image_id ? "camera" : "none");
  const hasPhoto = photoSrc === "uploaded";
  const avatarUrl = emp
    ? photoSrc === "uploaded"
      ? `/faces/emp/${encodeURIComponent(emp.emp_id)}?v=${photo?.ver ?? 0}`
      : photoSrc === "camera"
      ? `/faces/${data!.emp.image_id}`
      : undefined
    : undefined;

  const uploadPhoto = async (file: File) => {
    if (!emp) return;
    setPhotoBusy(true);
    try {
      await api.uploadEmpPhoto(emp.emp_id, await downscalePhoto(file));
      setPhoto({ src: "uploaded", ver: Date.now() });
    } catch (e) {
      alert((e as Error).message || "Photo upload failed");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Uploaded photo → delete it (falls back to camera capture, if any).
  // Camera photo → hide it (the synced file is read-only; the server stores a
  // "hidden" marker, and the photo disappears from lists + live display too).
  const removePhoto = async () => {
    if (!emp || photoSrc === "none") return;
    const msg =
      photoSrc === "uploaded"
        ? data?.emp?.image_id
          ? "Remove the uploaded photo? The camera capture will show again."
          : "Remove the uploaded photo?"
        : "Remove this camera photo? It will be hidden everywhere (lists + live display).";
    if (!confirm(msg)) return;
    setPhotoBusy(true);
    try {
      await api.deleteEmpPhoto(emp.emp_id, photoSrc === "camera");
      setPhoto({ src: photoSrc === "uploaded" && data?.emp?.image_id ? "camera" : "none", ver: Date.now() });
    } catch (e) {
      alert((e as Error).message || "Could not remove the photo");
    } finally {
      setPhotoBusy(false);
    }
  };

  const exportPdf = async () => {
    if (!emp || !data) return;
    setExporting(true);
    try {
      // jsPDF is heavy — load it only when an export is actually requested.
      const { exportEmployeePdf } = await import("../lib/employeePdf");
      await exportEmployeePdf({
        emp,
        range,
        cafeteriaName: cafe ? cafeterias.find((c) => c.id === cafe)?.name ?? null : null,
        meal,
        kpi: data.kpi ?? {},
        totalMeals: data.totalMeals ?? 0,
        punches: data.punches ?? [],
      });
    } catch (e) {
      alert((e as Error).message || "PDF export failed");
    } finally {
      setExporting(false);
    }
  };

  const cafeName = cafe ? cafeterias.find((c) => c.id === cafe)?.name ?? `Cafeteria #${cafe}` : "All cafeterias";
  const period = rangeLabel(range);

  const exportBtn = (cls: string) => (
    <button onClick={exportPdf} disabled={exporting || !data} className={cls}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {exporting ? "Preparing…" : "Export PDF"}
    </button>
  );

  // The dossier: a black identity rail (portrait · scope · headline total) beside
  // a bege ledger (meal KPIs + punch history). Modal chrome is bare — this owns
  // the whole canvas.
  return (
    <Modal open={!!emp} onClose={onClose} width={920} bare>
      <div className="flex max-h-[min(88vh,840px)] flex-col sm:h-[min(88vh,840px)] sm:flex-row">
        {/* ───── Identity rail ───── */}
        <aside className="relative shrink-0 overflow-hidden bg-black p-6 text-white sm:w-[268px] sm:p-7">
          {/* min-h-0 + overflow-y-auto: on short screens the rail scrolls instead
              of clipping the total / Export PDF at the bottom. */}
          <div className="relative flex h-full min-h-0 flex-row items-start gap-5 overflow-y-auto sm:flex-col sm:items-stretch">
            {/* Portrait + photo controls */}
            <div className="w-24 shrink-0 sm:w-full">
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-white/20">
                <FaceFill
                  key={avatarUrl ?? "none"}
                  empId={emp?.emp_id ?? null}
                  name={emp?.name ?? null}
                  imageUrl={avatarUrl}
                  fontSize="clamp(1.6rem, 5vw, 3.4rem)"
                />
              </div>
              {canManagePhoto && (
                <div className="mt-2.5 flex gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={photoBusy}
                    className="flex-1 rounded-lg border border-white/20 px-2 py-1.5 text-[11px] font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    {photoBusy ? "Working…" : photoSrc !== "none" ? "Replace photo" : "Upload photo"}
                  </button>
                  {photoSrc !== "none" && (
                    <button
                      onClick={removePhoto}
                      disabled={photoBusy}
                      aria-label="Remove photo"
                      title={photoSrc === "uploaded" ? "Remove uploaded photo" : "Hide camera photo"}
                      className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:border-error hover:bg-error hover:text-white disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Name + ID */}
            <div className="min-w-0 flex-1 sm:mt-5 sm:flex-none">
              <h3 className="text-xl font-bold leading-tight tracking-tight sm:text-[22px]">{emp?.name}</h3>
              <div className="tnum mt-1 text-[11px] font-medium tracking-[0.2em] text-white/50">{emp?.emp_id}</div>
            </div>

            <div className="mt-5 hidden h-px w-full shrink-0 bg-white/15 sm:block" />

            {/* Scope */}
            <dl className="mt-5 hidden space-y-3.5 sm:block">
              {[
                ["Period", period],
                ["Cafeteria", cafeName],
                ["Meal", meal ?? "All meals"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.24em] text-white/40">{k}</dt>
                  <dd className="mt-0.5 text-[13px] font-medium leading-snug text-white/90">{v}</dd>
                </div>
              ))}
            </dl>

            {/* Headline total — just the number; export lives in the ledger toolbar. */}
            <div className="mt-auto hidden pt-6 sm:block">
              <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-white/40">
                {meal ? `${meal} meals in period` : "Total meals in period"}
              </div>
              <div className="tnum mt-1.5 text-[46px] font-bold leading-none tracking-tight">
                {data ? count(data.totalMeals) : "—"}
              </div>
            </div>
          </div>
        </aside>

        {/* ───── Ledger ───── */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-bege">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-20 grid h-8 w-8 place-content-center rounded-lg text-ink-secondary transition-colors hover:bg-black/5 hover:text-black"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>

          {loading && !data ? (
            <div className="space-y-4 p-7 pt-14">
              <CardSkeleton h={92} />
              <CardSkeleton h={320} />
            </div>
          ) : data ? (
            <>
              <div className="px-6 pb-4 pt-6 sm:px-7">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-secondary">
                  Meal breakdown
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {MEAL_KPIS.map((m, i) => {
                    const active = meal === m.k;
                    return (
                      <div
                        key={m.k}
                        style={{ animationDelay: `${i * 70}ms` }}
                        className={`relative overflow-hidden rounded-xl p-3.5 shadow-card animate-fade-up ${
                          active ? "bg-black text-white" : "bg-surface-white"
                        }`}
                      >
                        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: m.tone }} />
                        <div
                          className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            active ? "text-white/60" : "text-ink-secondary"
                          }`}
                        >
                          {m.k}
                        </div>
                        <div className="tnum mt-1.5 text-[26px] font-bold leading-none">{count(data.kpi?.[m.k] ?? 0)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between px-6 pb-2 sm:px-7">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-secondary">
                  Punch history
                  <span className="tnum ml-2 normal-case tracking-normal text-ink-secondary/70">· {count(data.punches.length)} punches</span>
                </div>
                {exportBtn(
                  "hidden items-center gap-1.5 rounded-full bg-black px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-black/85 disabled:opacity-50 sm:flex"
                )}
              </div>

              <div className="min-h-0 flex-1 px-6 pb-6 sm:px-7">
                <div className="max-h-full overflow-y-auto rounded-xl border bg-surface-white">
                  {data.punches.length ? (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-surface-white shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                        <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-secondary">
                          <th className="px-4 py-2.5 font-semibold">Date</th>
                          <th className="px-4 py-2.5 font-semibold">Time</th>
                          <th className="px-4 py-2.5 font-semibold">Meal</th>
                          <th className="px-4 py-2.5 font-semibold">Cafeteria · Device</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.punches.map((p: any, i: number) => (
                          <tr
                            key={p.id}
                            style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                            className="border-b border-black/5 transition-colors animate-fade-up last:border-0 hover:bg-black/[0.025]"
                          >
                            <td className="px-4 py-2.5 font-medium">{dateOf(p.punched_at)}</td>
                            <td className="tnum px-4 py-2.5 text-ink-secondary">{timeOf(p.punched_at)}</td>
                            <td className="px-4 py-2">
                              {p.meal ? (
                                <span
                                  className="pill text-[11px] font-semibold"
                                  style={{ background: `${MEAL_TONE[p.meal] ?? "#000000"}14`, color: MEAL_TONE[p.meal] ?? "#000000" }}
                                >
                                  {p.meal}
                                </span>
                              ) : (
                                <span className="text-ink-secondary">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-[13px] text-ink-secondary">
                              {(p.cafeteria_name ? p.cafeteria_name + " · " : "") + (p.device_id ?? "—")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Empty>No meals in this period.</Empty>
                  )}
                </div>
              </div>

              {/* Compact footer for small screens (the rail collapses there) */}
              <div className="flex items-center justify-between gap-3 border-t bg-surface-white px-6 py-3 sm:hidden">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-secondary">
                    {meal ? `${meal} meals` : "Total meals"}
                  </div>
                  <div className="tnum text-xl font-bold leading-tight">{count(data.totalMeals)}</div>
                </div>
                {exportBtn(
                  "flex items-center gap-1.5 rounded-full bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-black/85 disabled:opacity-50"
                )}
              </div>
            </>
          ) : (
            <Empty>Couldn't load this employee.</Empty>
          )}
        </section>
      </div>
    </Modal>
  );
}
