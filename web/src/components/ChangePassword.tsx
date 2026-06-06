import { useState } from "react";
import { api } from "../lib/api";
import { Modal } from "./ui";

const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const strong = STRONG.test(next);
  const match = next.length > 0 && next === confirm;
  const valid = current.length > 0 && strong && match;

  function reset() {
    setCurrent(""); setNext(""); setConfirm(""); setErr(null); setDone(false); setBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    const res = await api.changePassword(current, next);
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not change password");
    setDone(true);
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      subtitle={done ? undefined : "Update the password for your account."}
    >
      {done ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Your password has been updated.
          </div>
          <button
            onClick={close}
            className="w-full rounded-xl bg-black py-2.5 text-sm font-semibold text-white hover:bg-black/85"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password" value={current} onChange={setCurrent} autoFocus />
          <Field label="New password" value={next} onChange={setNext} />
          <div className="flex items-center gap-2 text-xs">
            <Dot ok={strong} />
            <span className={strong ? "text-success" : "text-ink-secondary"}>
              8+ chars · upper, lower, number &amp; symbol
            </span>
          </div>
          <Field label="Confirm new password" value={confirm} onChange={setConfirm} />
          {confirm.length > 0 && !match && (
            <div className="text-xs font-medium text-error">Passwords don't match.</div>
          )}
          {err && (
            <div className="rounded-xl border border-error/30 bg-error/5 px-3.5 py-2.5 text-sm text-error">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-black/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || busy}
              className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-40"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</span>
      <input
        type="password"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border bg-surface-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
      />
    </label>
  );
}

const Dot = ({ ok }: { ok: boolean }) => (
  <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-black/20"}`} />
);
