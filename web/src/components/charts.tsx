import { useMemo, useState } from "react";

// --- Smooth area/line chart (pure SVG, stroke kept crisp while stretching) ---
const niceMax = (v: number) => {
  if (v <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`);

export function AreaChart({
  data,
  height = 200,
  color = "#000000",
  fill = "rgba(0,0,0,0.10)",
  unit = "",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  fill?: string;
  unit?: string;
}) {
  const W = 600;
  const H = height;
  const pad = 10;
  const [hover, setHover] = useState<number | null>(null);

  const { line, area, points, max } = useMemo(() => {
    const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
    const n = data.length;
    const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad);
    const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
    const pts = data.map((d, i) => ({ x: x(i), y: y(d.value), ...d }));
    if (!pts.length) return { line: "", area: "", points: [] as typeof pts, max };
    let line = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      line += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    const area = `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`;
    return { line, area, points: pts, max };
  }, [data, H]);

  const ticks = [1, 0.75, 0.5, 0.25, 0]; // top→bottom fractions of max
  const xCount = Math.min(points.length, 6);
  const xIdx = points.length
    ? Array.from({ length: xCount }, (_, k) => Math.round((k / Math.max(1, xCount - 1)) * (points.length - 1)))
    : [];
  const lastPt = points[points.length - 1];

  return (
    <div className="w-full select-none">
      <div className="flex">
        {/* y-axis labels */}
        <div className="flex flex-col justify-between pr-2 text-right text-[10px] tnum text-ink-secondary" style={{ height: H, paddingTop: pad, paddingBottom: pad }}>
          {ticks.map((t) => (
            <div key={t}>{kfmt(Math.round(max * t))}</div>
          ))}
        </div>

        {/* plot */}
        <div className="relative flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fill} />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </linearGradient>
            </defs>
            {/* gridlines */}
            {ticks.map((t) => {
              const yy = pad + (1 - t) * (H - 2 * pad);
              return <line key={t} x1={0} y1={yy} x2={W} y2={yy} stroke="rgba(0,0,0,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
            })}
            <path d={area} fill="url(#areaFill)" />
            <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {lastPt && <circle cx={lastPt.x} cy={lastPt.y} r={4} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {points.map((p, i) => (
              <g key={i}>
                <rect x={p.x - W / Math.max(points.length, 1) / 2} y={0} width={W / Math.max(points.length, 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
                {hover === i && (
                  <>
                    <line x1={p.x} y1={pad} x2={p.x} y2={H - pad} stroke="rgba(0,0,0,0.25)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    <circle cx={p.x} cy={p.y} r={5} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </>
                )}
              </g>
            ))}
          </svg>

          {hover !== null && points[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-black px-2.5 py-1.5 text-xs text-white shadow-pop tnum whitespace-nowrap"
              style={{ left: `${(points[hover].x / W) * 100}%`, top: `${(points[hover].y / H) * 100}%` }}
            >
              <div className="font-semibold">{points[hover].value.toLocaleString("en-IN")}{unit ? ` ${unit}` : ""}</div>
              <div className="text-white/60">{points[hover].label}</div>
            </div>
          )}

          {/* x-axis labels */}
          {xIdx.map((i) => (
            <div
              key={i}
              className="absolute -translate-x-1/2 text-[10px] text-ink-secondary"
              style={{ left: `${(points[i].x / W) * 100}%`, top: H + 4 }}
            >
              {points[i].label}
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 18 }} />
    </div>
  );
}

// --- Multi-line trend (pure SVG) — e.g. 4 meal lines per day ---
// All series share the same x positions (one per label) and a single y scale.
// Interactive on screen (hover guide + per-series dots + combined tooltip) and
// fully static-safe for print (hover just never fires). A legend sits above.
export function MultiLineChart({
  labels,
  series,
  height = 200,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
}) {
  const W = 680;
  const H = height;
  const pad = 12;
  const n = labels.length;
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const step = W / Math.max(n, 1);

  const pathFor = (vals: number[]) => {
    const pts = vals.map((v, i) => ({ x: x(i), y: y(v) }));
    if (!pts.length) return "";
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  };

  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const xCount = Math.min(n, 7);
  const xIdx = n ? Array.from({ length: xCount }, (_, k) => Math.round((k / Math.max(1, xCount - 1)) * (n - 1))) : [];
  const tipLeft = hover !== null ? Math.min(88, Math.max(12, (x(hover) / W) * 100)) : 0;

  return (
    <div className="w-full select-none">
      {/* legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-secondary">
            <span className="inline-block h-2.5 w-3.5 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="flex">
        <div className="flex flex-col justify-between pr-2 text-right text-[10px] tnum text-ink-secondary" style={{ height: H, paddingTop: pad, paddingBottom: pad }}>
          {ticks.map((t) => <div key={t}>{kfmt(Math.round(max * t))}</div>)}
        </div>
        <div className="relative flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            {ticks.map((t) => {
              const yy = pad + (1 - t) * (H - 2 * pad);
              return <line key={t} x1={0} y1={yy} x2={W} y2={yy} stroke="rgba(0,0,0,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
            })}
            {/* hover guide */}
            {hover !== null && (
              <line x1={x(hover)} y1={pad} x2={x(hover)} y2={H - pad} stroke="rgba(0,0,0,0.22)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
            {/* lines + soft glow so overlapping series stay legible */}
            {series.map((s) => (
              <path key={s.name} d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.95} />
            ))}
            {/* dots: last point always, all points on hover */}
            {series.map((s) => {
              const li = s.values.length - 1;
              if (li < 0) return null;
              return <circle key={`end-${s.name}`} cx={x(li)} cy={y(s.values[li])} r={3} fill={s.color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
            })}
            {hover !== null && series.map((s) => (
              <circle key={`h-${s.name}`} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
            {/* invisible hover hit-zones per x */}
            {labels.map((_, i) => (
              <rect key={i} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>

          {/* combined tooltip — date + each series value */}
          {hover !== null && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-black px-3 py-2 text-xs text-white shadow-pop"
              style={{ left: `${tipLeft}%`, top: 4 }}
            >
              <div className="mb-1 font-semibold">{labels[hover]}</div>
              <div className="space-y-0.5">
                {series.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-white/80">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="tnum font-semibold">{(s.values[hover] ?? 0).toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {xIdx.map((i) => (
            <div key={i} className="absolute -translate-x-1/2 text-[10px] text-ink-secondary" style={{ left: `${(x(i) / W) * 100}%`, top: H + 4 }}>
              {labels[i]}
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 18 }} />
    </div>
  );
}

// --- Donut for the company vs employee split ---
export function Donut({
  segments,
  size = 168,
  thickness = 22,
  centerLabel,
  centerSub,
  unitWord = "total",
}: {
  segments: { value: number; color: string; label: string; sub?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
  unitWord?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const active = hover !== null ? segments[hover] : null;
  const pct = active ? Math.round((active.value / total) * 100) : 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const isHover = hover === i;
          const dim = hover !== null && !isHover;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={isHover ? thickness + 6 : thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              opacity={dim ? 0.3 : 1}
              style={{ cursor: "pointer", transition: "stroke-width 0.15s, opacity 0.15s" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-content-center px-6 text-center">
        {active ? (
          <>
            {active.sub && <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: active.color }}>{active.sub}</div>}
            <div className="text-xl font-bold tnum leading-none" style={{ color: active.color }}>
              {active.value.toLocaleString("en-IN")}
            </div>
            <div className="mt-1 text-[11px] font-medium leading-tight">{active.label}</div>
            <div className="text-[11px] text-ink-secondary">{pct}% of {unitWord}</div>
          </>
        ) : (
          <>
            {centerLabel && <div className="text-2xl font-bold tnum leading-none">{centerLabel}</div>}
            {centerSub && <div className="mt-1 text-xs text-ink-secondary">{centerSub}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// --- Horizontal bar list ---
export function BarList({
  items,
  color = "#000000",
  valueFmt = (n: number) => n.toLocaleString("en-IN"),
}: {
  items: { label: string; sub?: string; value: number }[];
  color?: string;
  valueFmt?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div key={i} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium">{it.label}</span>
            <span className="tnum text-sm font-semibold">{valueFmt(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/5">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${(it.value / max) * 100}%`, background: color }}
            />
          </div>
          {it.sub && <div className="mt-0.5 text-xs text-ink-secondary">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// --- Hourly distribution (today) ---
const hourLabel = (h: number) => {
  const ap = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ap}`;
};
// "4:00 PM – 5:00 PM" — the full one-hour window a bar represents.
const hourRange = (h: number) => {
  const fmt = (x: number) => {
    const ap = x % 24 < 12 ? "AM" : "PM";
    const hr = x % 12 === 0 ? 12 : x % 12;
    return `${hr}:00 ${ap}`;
  };
  return `${fmt(h)} – ${fmt(h + 1)}`;
};

export function HourlyBars({
  data,
  height = 200,
  subtitle = "today",
  unit = "",
}: {
  data: { hour: number; meals: number }[];
  height?: number;
  subtitle?: string;
  unit?: string;
}) {
  const map = new Map(data.map((d) => [d.hour, d.meals]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, meals: map.get(h) ?? 0 }));
  const max = Math.max(1, ...hours.map((h) => h.meals));
  const peak = hours.reduce((a, b) => (b.meals > a.meals ? b : a), hours[0]);
  const nowHour = Number(
    new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
  );
  const total = hours.reduce((a, h) => a + h.meals, 0);

  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="tnum text-3xl font-bold leading-none">{total.toLocaleString("en-IN")}</div>
          <div className="mt-1 text-xs text-ink-secondary">{subtitle}</div>
        </div>
        {peak.meals > 0 && (
          <div className="text-right text-xs text-ink-secondary">
            Peak <span className="font-semibold text-ink">{hourLabel(peak.hour)}</span> · {peak.meals}
          </div>
        )}
      </div>

      <div className="relative" style={{ height }}>
        {/* baseline */}
        <div className="absolute inset-x-0 bottom-6 h-px bg-black/10" />
        <div className="flex h-full items-end gap-[2px] pb-6">
          {hours.map((h) => {
            const isNow = h.hour === nowHour;
            const isPeak = h.meals === peak.meals && h.meals > 0;
            const pct = (h.meals / max) * 100;
            return (
              <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t-[3px] transition-all duration-500"
                  style={{
                    height: `${pct}%`,
                    minHeight: h.meals ? 3 : 0,
                    background: isNow
                      ? "linear-gradient(180deg,#19B924,#0f7d18)"
                      : isPeak
                      ? "linear-gradient(180deg,#B93E19,#7d2911)"
                      : "linear-gradient(180deg,#2b2b2b,#000000)",
                  }}
                />
                {/* hover tooltip — count on top, full hour range below */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-2.5 py-1.5 text-center text-white shadow-pop group-hover:block">
                  <div className="tnum text-sm font-bold leading-none">{h.meals.toLocaleString("en-IN")}</div>
                  {unit && <div className="text-[9px] uppercase tracking-wide text-white/60">{unit}</div>}
                  <div className="mt-0.5 text-[10px] font-medium text-white/85">{hourRange(h.hour)}</div>
                </div>
                {/* x label every 3h */}
                {h.hour % 3 === 0 && (
                  <div className={`absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] tnum ${isNow ? "font-bold text-success" : "text-ink-secondary"}`}>
                    {hourLabel(h.hour)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
