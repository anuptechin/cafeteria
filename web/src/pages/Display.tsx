import { useEffect, useRef, useState } from "react";
import { api, useLivePunches, type Face } from "../lib/api";
import { FaceFill } from "../components/avatar";

const mono = "ui-monospace, 'Cascadia Code', 'Consolas', monospace";

// Full-screen CCTV-style surveillance wall: FIFO last-10 scanned faces,
// each rendered as a security-camera channel with HUD overlays, scanlines,
// REC indicators and a motion flash on every new scan.
export function Display({ onExit }: { onExit: () => void }) {
  const [faces, setFaces] = useState<Face[]>([]);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [clock, setClock] = useState(new Date());
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.recentFaces(10).then((f) => { setFaces(f); }).catch(() => {});
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const connected = useLivePunches((f) => {
    setFaces((cur) => (cur.some((x) => x.id === f.id) ? cur : [f, ...cur].slice(0, 10)));
    setCount((c) => c + 1);
    setFlash((s) => new Set(s).add(f.id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(f.id); return n; }), 1400);
  });

  const slots = Array.from({ length: 10 }, (_, i) => faces[i] ?? null);
  const ts = clock.toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-black text-white">
      <Scanlines />
      {/* header */}
      <header className="z-10 flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-4">
          <img src="/ddecor-logo.webp" alt="D'DECOR" className="h-12 w-auto object-contain" style={{ filter: "invert(1)" }} />
          <span className="h-5 w-px bg-white/20" />
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/50">
            Cafeteria Live
          </div>
        </div>
        <div className="flex items-center gap-5" style={{ fontFamily: mono }}>
          <span className="flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-success animate-pulse" : "bg-white/30"}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="text-lg font-semibold tnum">{ts}</span>
          <button onClick={onExit} className="rounded border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10">
            EXIT
          </button>
        </div>
      </header>

      {/* Wall: fixed 5 x 2, always fits the screen — no scrolling */}
      <div className="z-10 grid min-h-0 flex-1 grid-cols-5 grid-rows-2 gap-1.5 p-1.5">
        {slots.map((f, i) => (
          <Channel key={f ? f.id : `empty-${i}`} face={f} flashing={f ? flash.has(f.id) : false} newest={i === 0 && !!f} />
        ))}
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
      {/* subtle vignette */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 30%, transparent 45%, rgba(0,0,0,0.6) 100%)" }} />

      {/* name HUD */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-2.5 pt-8">
        <div className="text-lg font-bold leading-tight line-clamp-2" title={face.name}>{face.name}</div>
        <div className="mt-1 flex items-center justify-between text-xs text-white/65" style={{ fontFamily: mono }}>
          <span className="truncate">{face.emp_id}</span>
          <span className="shrink-0">{t}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-wider text-success">{face.cafeteria_name}</div>
      </div>
    </div>
  );
}

function FaceImg({ face }: { face: Face }) {
  return <FaceFill empId={face.emp_id} name={face.name} fontSize="clamp(2.2rem, 7vw, 5.5rem)" />;
}

// CRT scanline + flicker overlay across the whole wall.
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

function Noise() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const w = (cv.width = cv.offsetWidth);
      const h = (cv.height = cv.offsetHeight);
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 22;
      }
      ctx.putImageData(img, 0, 0);
      raf = window.setTimeout(() => requestAnimationFrame(draw), 90);
    };
    draw();
    return () => clearTimeout(raf);
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
