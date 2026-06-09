import { useEffect, useMemo, useState } from "react";
import { api, useLivePunches, type Face } from "../lib/api";
import { FaceFill } from "../components/avatar";

const mono = "ui-monospace, 'Cascadia Code', 'Consolas', monospace";

// Live kiosk shows ONE meal at a time (no "All meals") — Lunch is the default.
const MEALS = [
  { k: "Lunch", label: "Lunch", val: "Lunch" as string | null },
  { k: "Dinner", label: "Dinner", val: "Dinner" },
  { k: "Tea", label: "Tea", val: "Tea" },
  { k: "Biscuit", label: "Biscuit", val: "Biscuit" },
] as const;
type MealKey = (typeof MEALS)[number]["k"];

// Full-screen CCTV-style wall with a live MEAL COUNTER that resets per time slot.
// The digital clock lives in the top bar; the counter is the centre focus.
export function Display({ onExit }: { onExit: () => void }) {
  const [cafeterias, setCafeterias] = useState<{ id: number; name: string }[]>([]);
  const [cafe, setCafe] = useState<number | null>(null);
  const [meal, setMeal] = useState<MealKey>("Lunch");
  const mealVal = MEALS.find((m) => m.k === meal)!.val;
  const cafeName = useMemo(() => cafeterias.find((c) => c.id === cafe)?.name ?? null, [cafeterias, cafe]);

  const [faces, setFaces] = useState<Face[]>([]);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [clock, setClock] = useState(new Date());
  const [count, setCount] = useState(0);
  const [countLabel, setCountLabel] = useState("Lunch");

  useEffect(() => {
    api.liveCafeterias().then(setCafeterias).catch(() => {});
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshCount = () =>
    api.liveCount(cafe, mealVal).then((d) => { setCount(d.count); setCountLabel(d.label); }).catch(() => {});

  // Reload wall + counter on selection change; slow poll keeps the slot-bounded
  // counter honest across slot boundaries and midnight.
  useEffect(() => {
    api.recentFaces(10, cafe, mealVal).then(setFaces).catch(() => {});
    refreshCount();
    const t = setInterval(refreshCount, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe, mealVal]);

  const matches = (f: Face) =>
    (cafe === null || f.cafeteria_name === cafeName) && (mealVal === null || f.meal === mealVal);

  const connected = useLivePunches((f) => {
    if (!matches(f)) return;
    setFaces((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 10)));
    setFlash((s) => new Set(s).add(f.id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(f.id); return n; }), 1400);
    refreshCount();
  });

  const slots = Array.from({ length: 10 }, (_, i) => faces[i] ?? null);
  const scope = `${cafeName ?? "All cafeterias"} · ${countLabel}`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-black text-white">
      <Scanlines />

      {/* TOP BAR — selectors + live counter (left) · clock + status (right). Sits
          above the scanline overlay so the controls are always crisp. */}
      <header className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-white/10 bg-black/80 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-4">
          <img src="/ddecor-logo.webp" alt="D'DECOR" className="h-10 w-auto object-contain" style={{ filter: "invert(1)" }} />
          <span className="h-9 w-px bg-white/20" />
          <LabeledSelect label="Cafeteria" value={cafe ?? ""} onChange={(v) => setCafe(v ? Number(v) : null)}>
            <option value="">All cafeterias</option>
            {cafeterias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </LabeledSelect>
          <LabeledSelect label="Meal" value={meal} onChange={(v) => setMeal(v as MealKey)}>
            {MEALS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
          </LabeledSelect>
          <CounterChip count={count} scope={scope} />
        </div>

        <div className="flex items-center gap-5">
          <TopClock date={clock} />
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ fontFamily: mono }}>
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-success animate-pulse" : "bg-white/30"}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <button onClick={onExit} className="rounded border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10">EXIT</button>
        </div>
      </header>

      {/* Wall: fixed 5 x 2, always fits the screen — no scrolling */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-5 grid-rows-2 gap-1.5 p-1.5">
        {slots.map((f, i) => (
          <Channel key={f ? f.id : `empty-${i}`} face={f} flashing={f ? flash.has(f.id) : false} newest={i === 0 && !!f} />
        ))}
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">{label}</span>
      {/* Light control so the native option list is always readable (dark-on-light). */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[9.5rem] rounded-md border border-white/50 bg-white px-3 py-1.5 text-sm font-semibold text-black outline-none transition-colors hover:bg-white focus:border-success"
      >
        {children}
      </select>
    </label>
  );
}

// Compact live meal counter that sits beside the dropdowns in the top bar.
function CounterChip({ count, scope }: { count: number; scope: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-1.5" style={{ fontFamily: mono }}>
      <div className="leading-none">
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-success/80">Live Meals · {scope}</div>
        <div key={count} className="animate-pop-in tnum text-4xl font-black text-white" style={{ textShadow: "0 0 16px rgba(25,185,36,0.4)" }}>
          {count.toLocaleString("en-IN")}
        </div>
      </div>
    </div>
  );
}

// Compact glowing clock for the top bar.
function TopClock({ date }: { date: Date }) {
  const p = (n: number) => String(n).padStart(2, "0");
  const ist = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const blink = date.getSeconds() % 2 === 0;
  const dateStr = ist.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  return (
    <div className="flex items-center gap-3" style={{ fontFamily: mono }}>
      <div className="text-right leading-none">
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">IST</div>
        <div className="text-[10px] font-medium text-white/55">{dateStr}</div>
      </div>
      <div
        className="tnum font-bold leading-none"
        style={{ fontSize: "2rem", color: "#19B924", textShadow: "0 0 14px rgba(25,185,36,0.55), 0 0 3px rgba(25,185,36,0.9)" }}
      >
        {p(ist.getHours())}<span className={blink ? "opacity-100" : "opacity-25"}>:</span>{p(ist.getMinutes())}
        <span className="text-base text-success/70">{" "}{p(ist.getSeconds())}</span>
      </div>
    </div>
  );
}

function Channel({ face, flashing, newest }: { face: Face | null; flashing: boolean; newest: boolean }) {
  if (!face) {
    return <div className="min-h-0 overflow-hidden rounded-sm border border-white/10 bg-[#070707]" />;
  }
  const t = new Date(face.punched_at).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-sm border bg-black transition-all duration-300 ${
        flashing ? "border-success ring-2 ring-success" : newest ? "border-success/70" : "border-white/10"
      }`}
    >
      <FaceImg face={face} />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 30%, transparent 45%, rgba(0,0,0,0.6) 100%)" }} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-2.5 pt-8">
        <div className="text-lg font-bold leading-tight line-clamp-2" title={face.name ?? ""}>{face.name ?? "Unknown"}</div>
        <div className="mt-1 flex items-center justify-between text-xs text-white/65" style={{ fontFamily: mono }}>
          <span className="truncate">{face.emp_id ?? "—"}</span>
          <span className="shrink-0">{t}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider">
          <span className="truncate text-success">{(face.cafeteria_name ? face.cafeteria_name + " · " : "") + (face.device_id ?? "—")}</span>
          {face.meal && <span className="shrink-0 rounded bg-success/20 px-1.5 py-0.5 text-success">{face.meal}</span>}
        </div>
      </div>
    </div>
  );
}

function FaceImg({ face }: { face: Face }) {
  return (
    <FaceFill
      empId={face.emp_id}
      name={face.name}
      imageUrl={face.has_image ? `/faces/${face.id}` : null}
      fontSize="clamp(2.2rem, 7vw, 5.5rem)"
    />
  );
}

// CRT scanline overlay — kept BELOW the top bar / counter (z-20 < z-30) so the
// controls stay crisp, but above the camera wall (z-10) for the CRT look.
function Scanlines() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-20 opacity-[0.16]"
      style={{
        backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.0) 0px, rgba(0,0,0,0.0) 2px, rgba(0,0,0,0.6) 3px, rgba(0,0,0,0.0) 4px)",
      }}
    />
  );
}
