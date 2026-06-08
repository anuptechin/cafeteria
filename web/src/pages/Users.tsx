import { useState } from "react";
import {
  api,
  usePoll,
  useCafeterias,
  canManageTarget,
  creatableRoles,
  ROLE_LABEL,
  type ManagedUser,
  type Role,
} from "../lib/api";

// Roles whose data access is limited to assigned cafeterias.
const RESTRICTED: Role[] = ["hr_manager", "canteen_manager"];
const isRestricted = (r: Role) => RESTRICTED.includes(r);
import { Card, CardSkeleton, Modal } from "../components/ui";
import { useAuth } from "../lib/auth";
import { ago, dateOf, initials } from "../lib/format";

export function Users() {
  const { user } = useAuth();
  const me = user!;
  const { data, loading, reload } = usePoll(() => api.users(), [], 0);
  const cafeterias = useCafeterias();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Users & Access</h1>
        <p className="mt-0.5 text-sm text-ink-secondary">
          {me.role === "super_admin"
            ? "Create and manage admins, HR managers and canteen managers. The super admin can never be removed."
            : "Create and manage HR managers and canteen managers. Admins and the super admin are managed by the super admin."}
        </p>
      </header>

      <CreateUser actorRole={me.role} cafeterias={cafeterias} onCreated={reload} />

      {loading && !data ? (
        <CardSkeleton h={240} />
      ) : (
        <Card title={`Accounts (${data?.length ?? 0})`} className="!p-0">
          <div className="divide-y">
            {data?.map((u) => (
              <UserRow key={u.id} u={u} actorRole={me.role} me={me.id === u.id} cafeterias={cafeterias} onChange={reload} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

function RoleBadge({ role }: { role: Role }) {
  const tone =
    role === "super_admin"
      ? "bg-black text-white"
      : role === "admin"
      ? "bg-black/[0.06] text-ink-secondary"
      : role === "hr_manager"
      ? "bg-success/10 text-success"
      : "bg-alert/10 text-alert";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

// Multi-select list of cafeterias (checkbox chips). Used for restricted roles.
function CafeteriaMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Cafeteria access</span>
        <span className="text-[11px] text-ink-secondary">{selected.length ? `${selected.length} selected` : "none — no access"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-xl border bg-surface-bege p-2">
        {options.length === 0 && <span className="px-1 text-xs text-ink-secondary">No cafeterias defined yet.</span>}
        {options.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                on ? "bg-black text-white" : "border bg-surface-white text-ink-secondary hover:bg-black/5"
              }`}
            >
              {on ? "✓ " : ""}{c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreateUser({ actorRole, cafeterias, onCreated }: { actorRole: Role; cafeterias: { id: number; name: string }[]; onCreated: () => void }) {
  const roleOptions = creatableRoles(actorRole);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(roleOptions[0] ?? "canteen_manager");
  const [cafes, setCafes] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = name.trim() && username.trim() && STRONG.test(password) && roleOptions.includes(role);

  function close() {
    setName(""); setUsername(""); setPassword(""); setRole(roleOptions[0] ?? "canteen_manager");
    setCafes([]); setErr(null); setBusy(false); setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    const res = await api.createUser({
      name: name.trim(), username: username.trim(), password, role,
      cafeterias: isRestricted(role) ? cafes : undefined,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not create user");
    close();
    onCreated();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black/85"
      >
        <span className="text-base leading-none">+</span> New User
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Create user"
        subtitle="The new account can sign in immediately with this password."
        width={480}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
            <Input label="Username / Email" value={username} onChange={setUsername} placeholder="jane@ddecor.com" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Temporary password" value={password} onChange={setPassword} placeholder="Strong@123" type="password" />
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-lg border bg-surface-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${STRONG.test(password) ? "bg-success" : "bg-black/20"}`} />
            <span className={password && !STRONG.test(password) ? "text-error" : "text-ink-secondary"}>
              8+ chars · upper, lower, number & symbol
            </span>
          </div>

          {isRestricted(role) && (
            <CafeteriaMultiSelect options={cafeterias} selected={cafes} onChange={setCafes} />
          )}

          <div className="rounded-xl border bg-surface-bege px-3.5 py-2.5 text-xs text-ink-secondary">
            {role === "canteen_manager"
              ? "Canteen managers see the Live Display only — limited to the cafeterias selected above."
              : role === "hr_manager"
              ? "HR managers have full access except User Management — data limited to the cafeterias selected above."
              : "Admins have full access (all cafeterias)."}
          </div>

          {err && (
            <div className="rounded-xl border border-error/30 bg-error/5 px-3.5 py-2.5 text-sm text-error">{err}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-black/5">
              Cancel
            </button>
            <button type="submit" disabled={!valid || busy} className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-40">
              {busy ? "Creating…" : `Create ${ROLE_LABEL[role].toLowerCase()}`}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function UserRow({
  u,
  actorRole,
  me,
  cafeterias,
  onChange,
}: {
  u: ManagedUser;
  actorRole: Role;
  me: boolean;
  cafeterias: { id: number; name: string }[];
  onChange: () => void;
}) {
  const sup = u.role === "super_admin";
  const manageable = canManageTarget(actorRole, u.role) && !me;
  const restricted = isRestricted(u.role);
  const [resetting, setResetting] = useState(false);
  const [editingCafes, setEditingCafes] = useState(false);
  const [cafes, setCafes] = useState<number[]>(u.cafeterias ?? []);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const cafeNames = (u.cafeterias ?? [])
    .map((id) => cafeterias.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];

  async function saveCafes() {
    setBusy(true);
    const res: any = await api.updateUser(u.id, { cafeterias: cafes });
    setBusy(false);
    if (!res.ok) return alert(res.error ?? "Could not update access");
    setEditingCafes(false);
    onChange();
  }

  async function toggle() {
    setBusy(true);
    await api.updateUser(u.id, { active: !u.active });
    setBusy(false);
    onChange();
  }
  async function remove() {
    if (!confirm(`Delete ${ROLE_LABEL[u.role].toLowerCase()} "${u.name}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await api.deleteUser(u.id);
    setBusy(false);
    if (!res.ok) alert(res.error ?? "Delete failed");
    onChange();
  }
  async function doReset() {
    if (!STRONG.test(pw)) return;
    setBusy(true);
    const res = await api.resetUserPassword(u.id, pw);
    setBusy(false);
    if (!res.ok) return alert(res.error ?? "Reset failed");
    setResetting(false); setPw("");
    alert("Password updated.");
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`grid h-11 w-11 shrink-0 place-content-center rounded-full text-sm font-bold text-white ${
            sup ? "bg-black" : u.active ? "bg-ink-secondary" : "bg-black/25"
          }`}
        >
          {initials(u.name || u.username)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{u.name}</span>
            <RoleBadge role={u.role} />
            {me && <span className="text-[11px] font-medium text-ink-secondary">(you)</span>}
            {!sup && !u.active && (
              <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-error">
                Disabled
              </span>
            )}
          </div>
          <div className="truncate text-xs text-ink-secondary">{u.username}</div>
          {restricted && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">Cafeterias:</span>
              {cafeNames.length ? (
                cafeNames.map((n) => (
                  <span key={n} className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">{n}</span>
                ))
              ) : (
                <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-semibold text-error">none — no data access</span>
              )}
            </div>
          )}
        </div>

        <div className="hidden text-right text-xs text-ink-secondary sm:block">
          <div>{u.last_login_at ? `Last seen ${ago(u.last_login_at)}` : "Never signed in"}</div>
          <div>Added {dateOf(u.created_at)}{u.created_by ? ` · by ${u.created_by}` : ""}</div>
        </div>

        {sup ? (
          <span className="flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-3 py-2 text-xs font-medium text-ink-secondary">
            <IconLock /> Protected
          </span>
        ) : manageable ? (
          <div className="flex items-center gap-2">
            {restricted && (
              <button onClick={() => setEditingCafes((v) => !v)} disabled={busy} className="btn-ghost">Access</button>
            )}
            <button onClick={() => setResetting((v) => !v)} disabled={busy} className="btn-ghost">Reset password</button>
            <button onClick={toggle} disabled={busy} className="btn-ghost">{u.active ? "Disable" : "Enable"}</button>
            <button onClick={remove} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-semibold text-error transition-colors hover:bg-error/10">
              Delete
            </button>
          </div>
        ) : (
          <span className="text-xs text-ink-secondary">{me ? "This is you" : "Managed by super admin"}</span>
        )}
      </div>

      {resetting && manageable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-surface-bege p-3 animate-fade-up">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New strong password"
            className="flex-1 rounded-lg border bg-surface-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <button onClick={doReset} disabled={!STRONG.test(pw) || busy} className="rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
            Set password
          </button>
        </div>
      )}

      {editingCafes && manageable && restricted && (
        <div className="mt-3 space-y-2 rounded-xl border bg-surface-bege p-3 animate-fade-up">
          <CafeteriaMultiSelect options={cafeterias} selected={cafes} onChange={setCafes} />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setCafes(u.cafeterias ?? []); setEditingCafes(false); }} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-black/5">
              Cancel
            </button>
            <button onClick={saveCafes} disabled={busy} className="rounded-lg bg-black px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Save access
            </button>
          </div>
        </div>
      )}

      <style>{`.btn-ghost{border:1px solid rgba(0,0,0,0.16);border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;transition:background-color .15s}.btn-ghost:hover{background:rgba(0,0,0,0.04)}.btn-ghost:disabled{opacity:.4}`}</style>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-surface-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10"
      />
    </label>
  );
}

const IconLock = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
