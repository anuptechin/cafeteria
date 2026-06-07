import { useEffect } from "react";
import { FaceFill } from "./avatar";

// Centered modal dialog (messagebox) with a dimmed backdrop.
// Closes on backdrop click or Escape.
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-up" />
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width }}
        className="relative w-full max-w-[calc(100vw-2rem)] rounded-2xl border bg-surface-white p-6 shadow-pop animate-pop-in"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-content-center rounded-lg text-ink-secondary transition-colors hover:bg-black/5 hover:text-black"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = "#000000",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card relative overflow-hidden p-5 animate-fade-up">
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</span>
        {icon && <span className="text-ink-secondary">{icon}</span>}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight tnum">{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-secondary">{sub}</div>}
    </div>
  );
}

import type { RangeState } from "../lib/api";

const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function RangePicker({
  value,
  onChange,
}: {
  value: RangeState;
  onChange: (v: RangeState) => void;
}) {
  const opts = [
    { k: "today", l: "Today" },
    { k: "7d", l: "7 Days" },
    { k: "30d", l: "30 Days" },
    { k: "60d", l: "60 Days" },
    { k: "custom", l: "Custom" },
  ];

  const pick = (k: string) => {
    if (k === "custom") {
      const to = value.to || todayISO();
      const from =
        value.from ||
        new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      onChange({ key: "custom", from, to });
    } else {
      onChange({ key: k, from: "", to: "" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-full border bg-surface-white p-0.5">
        {opts.map((o) => (
          <button
            key={o.k}
            onClick={() => pick(o.k)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              value.key === o.k ? "bg-black text-white" : "text-ink-secondary hover:text-black"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>

      {value.key === "custom" && (
        <div className="flex items-center gap-1.5 rounded-full border bg-surface-white px-2 py-1 text-xs">
          <input
            type="date"
            value={value.from}
            max={value.to || todayISO()}
            onChange={(e) => onChange({ ...value, key: "custom", from: e.target.value })}
            className="tnum rounded bg-transparent px-1 outline-none"
          />
          <span className="text-ink-secondary">→</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={todayISO()}
            onChange={(e) => onChange({ ...value, key: "custom", to: e.target.value })}
            className="tnum rounded bg-transparent px-1 outline-none"
          />
        </div>
      )}
    </div>
  );
}

export function Avatar({
  empId,
  name,
  imageUrl,
  size = 40,
  ring,
}: {
  empId: string | null;
  name: string | null;
  imageUrl?: string | null;
  size?: number;
  ring?: string;
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    >
      <FaceFill empId={empId} name={name} imageUrl={imageUrl} fontSize={Math.round(size * 0.38)} />
    </div>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "success" | "alert" | "error"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-ink-secondary",
    success: "bg-success/10 text-success",
    alert: "bg-alert/10 text-alert",
    error: "bg-error/10 text-error",
  };
  return <span className={`pill ${tones[tone]}`}>{children}</span>;
}

export function CardSkeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid place-content-center py-12 text-sm text-ink-secondary">{children}</div>;
}
