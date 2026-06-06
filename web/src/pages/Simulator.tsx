import { useState } from "react";
import { api } from "../lib/api";
import { Card, Avatar, Empty, Pill } from "../components/ui";
import { timeOf, dateOf } from "../lib/format";

type Sent = { id: number; emp_id: string; name: string; cafeteria_name: string; punched_at: string };

// Minimal testing tool: type an Employee ID, press Record — a punch is logged
// with the current timestamp (the "timeline"). To be removed later.
export function Simulator({ goLive }: { goLive: () => void }) {
  const [empId, setEmpId] = useState("");
  const [sent, setSent] = useState<Sent[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function record() {
    const id = empId.trim();
    if (!id) return;
    setBusy(true);
    setMsg(null);
    const res = await api.punch(id);
    setBusy(false);
    if (res.ok) {
      const r = res.data;
      setSent((cur) => [r, ...cur].slice(0, 20));
      setMsg({ kind: "ok", text: `Recorded · ${r.name}` });
      setEmpId("");
    } else {
      setMsg({ kind: "err", text: res.error ?? "Failed" });
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Punch Simulator</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Testing only — enter an Employee ID and the punch is recorded with the current time.
          </p>
        </div>
        <button onClick={goLive} className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80">
          Open Live Display ↗
        </button>
      </header>

      <Card className="mx-auto max-w-xl">
        <label className="mb-1.5 block text-xs font-medium text-ink-secondary">Employee ID</label>
        <div className="flex gap-2">
          <input
            autoFocus
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && record()}
            placeholder="e.g. 80014105"
            className="tnum flex-1 rounded-xl border bg-surface-bege px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-black/10"
          />
          <button
            disabled={busy || !empId.trim()}
            onClick={record}
            className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40 hover:bg-black/80"
          >
            {busy ? "Recording…" : "Record Punch"}
          </button>
        </div>
        {msg && (
          <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-success" : "text-error"}`}>{msg.text}</div>
        )}
        <p className="mt-3 text-xs text-ink-secondary">
          Timeline is set to now. Press Enter to record quickly. The scan appears instantly on the Live Display.
        </p>
      </Card>

      {sent[0] && (
        <Card className="mx-auto max-w-xl">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl">
              <Avatar empId={sent[0].emp_id} name={sent[0].name} size={80} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-secondary">Last recorded</div>
              <div className="text-lg font-bold">{sent[0].name}</div>
              <div className="tnum text-sm text-ink-secondary">
                {sent[0].emp_id} · {sent[0].cafeteria_name} · {timeOf(sent[0].punched_at)}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Recorded This Session" action={<Pill tone="success">{sent.length}</Pill>}>
        {sent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Cafeteria</th>
                  <th className="py-2 text-right font-medium">Date</th>
                  <th className="py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((s) => (
                  <tr key={s.id} className="border-b border-black/5 animate-fade-up">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar empId={s.emp_id} name={s.name} size={32} />
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="tnum text-xs text-ink-secondary">{s.emp_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5">{s.cafeteria_name}</td>
                    <td className="py-2.5 text-right">{dateOf(s.punched_at)}</td>
                    <td className="py-2.5 text-right tnum">{timeOf(s.punched_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nothing recorded yet. Enter an Employee ID above.</Empty>
        )}
      </Card>
    </div>
  );
}
