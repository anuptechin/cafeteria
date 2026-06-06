import { useState } from "react";
import { api, usePoll } from "../lib/api";
import { Card, CardSkeleton } from "../components/ui";

export function Admin() {
  const { data, loading, reload } = usePoll(() => api.config(), [], 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Admin & Configuration</h1>
        <p className="mt-0.5 text-sm text-ink-secondary">
          Map each Face Reader device to a cafeteria, and review meal slots.
        </p>
      </header>

      {loading && !data ? (
        <CardSkeleton h={240} />
      ) : data ? (
        <div className="grid grid-cols-1 gap-6">
          <DevicesCard devices={data.devices} onSaved={reload} />
          <SlotsCard slots={data.slots} />
        </div>
      ) : null}
    </div>
  );
}

function DevicesCard({ devices, onSaved }: { devices: any[]; onSaved: () => void }) {
  return (
    <Card title="Cafeteria / Device Mapping">
      <p className="mb-4 text-sm text-ink-secondary">
        Each Face Reader device (std_id) maps to a cafeteria name and location. Changes apply instantly — no redesign needed.
      </p>
      <div className="space-y-3">
        {devices.map((d) => (
          <DeviceRow key={d.std_id} device={d} onSaved={onSaved} />
        ))}
      </div>
    </Card>
  );
}

function DeviceRow({ device, onSaved }: { device: any; onSaved: () => void }) {
  const [name, setName] = useState(device.cafeteria_name);
  const [loc, setLoc] = useState(device.location ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = name !== device.cafeteria_name || loc !== (device.location ?? "");

  async function save() {
    const res = await api.updateDevice(device.std_id, { cafeteria_name: name, location: loc });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface-bege p-3">
      <div className="grid h-10 w-14 shrink-0 place-content-center rounded-lg bg-black text-xs font-bold text-white tnum">
        {device.std_id}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-[160px] flex-1 rounded-lg border bg-surface-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
        placeholder="Cafeteria name"
      />
      <input
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        className="w-24 rounded-lg border bg-surface-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
        placeholder="Block"
      />
      <button
        disabled={!dirty}
        onClick={save}
        className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white disabled:opacity-30 hover:bg-black/80"
      >
        {saved ? "✓ Saved" : "Save"}
      </button>
    </div>
  );
}

function SlotsCard({ slots }: { slots: any[] }) {
  return (
    <Card title="Meal Slots">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {slots.map((s) => (
          <div key={s.id} className="rounded-xl border bg-surface-bege p-3">
            <div className="font-semibold">{s.name}</div>
            <div className="tnum mt-1 text-xs text-ink-secondary">
              {String(s.start_time).slice(0, 5)} – {String(s.end_time).slice(0, 5)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
