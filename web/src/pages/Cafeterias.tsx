import { useState } from "react";
import {
  api,
  usePoll,
  CATEGORIES,
  CATEGORY_LABEL,
  type Cafeteria,
  type Device,
  type MealCategory,
} from "../lib/api";
import { Card, CardSkeleton, Modal, Empty } from "../components/ui";

// Admin / super-admin only (the nav + the API both enforce this). Lets staff
// define cafeterias, attach the punch devices for each meal category, and edit
// each cafeteria's meal time-slots. De-dup rule per slot: Lunch/Dinner count once
// for the whole slot; Tea/Snack drops repeats within 1 minute.
export function Cafeterias() {
  const { data, loading, reload } = usePoll(() => api.cafeterias(), [], 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cafeteria Settings</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Assign punch devices by meal type and set each cafeteria's meal time-slots. Lunch/Dinner
            count once per slot; Tea/Snack de-duplicates within 1 minute.
          </p>
        </div>
        <NewCafeteria onCreated={reload} />
      </header>

      {loading && !data ? (
        <CardSkeleton h={260} />
      ) : !data?.length ? (
        <Card>
          <Empty>No cafeterias yet. Create one to start assigning devices.</Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {data.map((c) => (
            <CafeteriaCard key={c.id} c={c} onChange={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewCafeteria({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setName(""); setErr(null); setBusy(false); setOpen(false);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    const res = await api.createCafeteria(name.trim());
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not create cafeteria");
    close(); onCreated();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black/85"
      >
        <span className="text-base leading-none">+</span> New Cafeteria
      </button>
      <Modal open={open} onClose={close} title="New cafeteria" subtitle="Give it a short name, e.g. F61." width={420}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Cafeteria name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="F61"
              className="w-full rounded-lg border bg-surface-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
          </Field>
          {err && <div className="rounded-xl border border-error/30 bg-error/5 px-3.5 py-2.5 text-sm text-error">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-black/5">Cancel</button>
            <button type="submit" disabled={!name.trim() || busy} className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-40">
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function CafeteriaCard({ c, onChange }: { c: Cafeteria; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    await api.updateCafeteria(c.id, { active: !c.active });
    setBusy(false); onChange();
  }
  async function remove() {
    if (!confirm(`Delete cafeteria "${c.name}" and all its device assignments? This cannot be undone.`)) return;
    setBusy(true);
    const res = await api.deleteCafeteria(c.id);
    setBusy(false);
    if (!(res as any).ok) return alert((res as any).error ?? "Delete failed");
    onChange();
  }

  const totalToday = Object.values(c.todayMeals).reduce((a, b) => a + b, 0);

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="grid h-11 w-11 shrink-0 place-content-center rounded-xl bg-black text-sm font-bold text-white">
          {c.name.slice(0, 3).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-lg font-bold tracking-tight">{c.name}</span>
            {!c.active && (
              <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-error">Inactive</span>
            )}
          </div>
          <div className="text-xs text-ink-secondary">
            {c.devices.length} device{c.devices.length === 1 ? "" : "s"} · {totalToday} meal{totalToday === 1 ? "" : "s"} today
          </div>
        </div>
        <button onClick={toggleActive} disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-40">
          {c.active ? "Deactivate" : "Activate"}
        </button>
        <button onClick={remove} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-40">
          Delete
        </button>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <CategoryColumn key={cat} cafeteriaId={c.id} category={cat} devices={c.devices.filter((d) => d.category === cat)} todayMeals={c.todayMeals[cat] ?? 0} onChange={onChange} />
        ))}
      </div>

      <TimeSlotsEditor c={c} onChange={onChange} />
    </Card>
  );
}

function TimeSlotsEditor({ c, onChange }: { c: Cafeteria; onChange: () => void }) {
  const sorted = [...c.slots].sort((a, b) => a.sort - b.sort);
  const [times, setTimes] = useState<Record<number, { start: string; end: string }>>(() =>
    Object.fromEntries(sorted.map((s) => [s.id, { start: hhmm(s.start_time), end: hhmm(s.end_time) }]))
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (sorted.length === 0) return null;

  function set(id: number, key: "start" | "end", v: string) {
    setTimes((t) => ({ ...t, [id]: { ...t[id], [key]: v } }));
    setSaved(false);
  }
  async function save() {
    setBusy(true);
    const res = await api.saveTimeSlots(
      c.id,
      sorted.map((s) => ({ id: s.id, start_time: times[s.id].start, end_time: times[s.id].end }))
    );
    setBusy(false);
    if (!(res as any).ok) return alert((res as any).error ?? "Could not save time-slots");
    setSaved(true); onChange();
  }

  return (
    <div className="border-t px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-secondary">Meal time-slots</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[11px] font-medium text-success">Saved ✓</span>}
          <button onClick={save} disabled={busy} className="rounded-lg bg-black px-4 py-1.5 text-xs font-semibold text-white hover:bg-black/85 disabled:opacity-40">
            {busy ? "Saving…" : "Save slots"}
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((s) => (
          <div key={s.id} className="rounded-xl border bg-surface-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">{s.meal}</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-secondary">
                {s.dedup_mode === "once_per_slot" ? "once / slot" : "1 min"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="time" value={times[s.id].start} onChange={(e) => set(s.id, "start", e.target.value)} className="tnum w-full rounded-lg border bg-surface-bege/40 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10" />
              <span className="text-ink-secondary">→</span>
              <input type="time" value={times[s.id].end} onChange={(e) => set(s.id, "end", e.target.value)} className="tnum w-full rounded-lg border bg-surface-bege/40 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-secondary">
        The late Tea/Snack slot may cross midnight (e.g. 23:01 → 11:29) — counts reset each calendar day.
      </p>
    </div>
  );
}

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "");

function CategoryColumn({
  cafeteriaId,
  category,
  devices,
  todayMeals,
  onChange,
}: {
  cafeteriaId: number;
  category: MealCategory;
  devices: Device[];
  todayMeals: number;
  onChange: () => void;
}) {
  return (
    <div className="rounded-xl border bg-surface-bege/40 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{CATEGORY_LABEL[category]}</span>
        <span className="tnum rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">{todayMeals} today</span>
      </div>
      <div className="space-y-1.5">
        {devices.length === 0 && <div className="py-1 text-xs text-ink-secondary">No devices.</div>}
        {devices.map((d) => (
          <DeviceChip key={d.device_id} d={d} onChange={onChange} />
        ))}
      </div>
      <AddDevice cafeteriaId={cafeteriaId} category={category} onAdded={onChange} />
    </div>
  );
}

function DeviceChip({ d, onChange }: { d: Device; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    const res = await api.deleteDevice(d.device_id);
    setBusy(false);
    if (!(res as any).ok) return alert((res as any).error ?? "Could not remove device");
    onChange();
  }
  return (
    <div className="flex items-center justify-between rounded-lg border bg-surface-white px-2.5 py-1.5">
      <span className="tnum text-sm font-semibold">{d.device_id}</span>
      <button onClick={remove} disabled={busy} title="Remove device" className="grid h-6 w-6 place-content-center rounded text-ink-secondary hover:bg-error/10 hover:text-error disabled:opacity-40">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

function AddDevice({ cafeteriaId, category, onAdded }: { cafeteriaId: number; category: MealCategory; onAdded: () => void }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const device_id = val.trim();
    if (!device_id || busy) return;
    setBusy(true); setErr(null);
    const res = await api.addDevice({ device_id, cafeteria_id: cafeteriaId, category });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not add device");
    setVal(""); onAdded();
  }
  return (
    <form onSubmit={add} className="mt-2">
      <div className="flex items-center gap-1.5">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Device ID"
          className="tnum w-full rounded-lg border bg-surface-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
        />
        <button type="submit" disabled={!val.trim() || busy} className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/85 disabled:opacity-40">
          Add
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] text-error">{err}</div>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}
