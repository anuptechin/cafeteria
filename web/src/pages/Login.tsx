import { useState } from "react";
import { useAuth } from "../lib/auth";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await login(username.trim(), password);
    if (!res.ok) {
      setError(res.error ?? "Login failed");
      setBusy(false);
    }
    // On success the app re-renders into the console.
  }

  return (
    <div className="lg-root">
      {/* ---------- brand side ---------- */}
      <aside className="lg-brand">
        <div className="lg-bloom lg-bloom-a" />
        <div className="lg-bloom lg-bloom-b" />
        <Drapes />

        <div className="lg-brand-top">
          <img src="/ddecor-logo.webp" alt="D'DECOR — Live beautiful" className="lg-logo" />
        </div>

        <div className="lg-brand-mid">
          <span className="lg-eyebrow">Cafeteria Management System</span>
          <blockquote className="lg-hero">
            <span className="lg-quote">“</span>
            Where Operational
            <br />
            Excellence Meets
            <br />
            <em>Exceptional Dining.</em>
          </blockquote>
          <span className="lg-rule" />
        </div>

        <div className="lg-brand-foot">© {new Date().getFullYear()} D'Decor · Live beautiful</div>
      </aside>

      {/* ---------- form side ---------- */}
      <main className="lg-form-wrap">
        <div className="lg-form">
          <img src="/ddecor-logo.webp" alt="D'DECOR" className="lg-logo-sm" />

          <header className="lg-head">
            <h2>Welcome back</h2>
            <p>Please sign in to continue to your console.</p>
          </header>

          <form onSubmit={submit} className="lg-fields">
            <label className="lg-field">
              <span>Username</span>
              <div className="lg-input">
                <IconUser />
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="you@ddecor.com"
                />
              </div>
            </label>

            <label className="lg-field">
              <span>Password</span>
              <div className="lg-input">
                <IconLock />
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="lg-eye"
                  tabIndex={-1}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
              {caps && <small className="lg-hint">Caps Lock is on</small>}
            </label>

            {error && (
              <div className="lg-error" role="alert">
                <IconAlert />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy || !username || !password} className="lg-submit">
              {busy ? (
                <Spinner />
              ) : (
                <>
                  Sign in
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="lg-foot">Secure access · D'Decor</p>
        </div>
      </main>

      <style>{css}</style>
    </div>
  );
}

/* flowing "drape" lines — a quiet nod to D'Decor furnishings */
function Drapes() {
  return (
    <svg className="lg-drapes" viewBox="0 0 600 900" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M ${-40 + i * 30} 0 C ${120 + i * 30} 260, ${40 + i * 30} 600, ${220 + i * 26} 900`}
          fill="none"
          stroke="#000"
          strokeOpacity={0.05}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="lg-spin" viewBox="0 0 24 24" width="20" height="20" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- icons ---------- */
const IconUser = () => (
  <svg viewBox="0 0 24 24" className="lg-ic" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" strokeLinecap="round" />
  </svg>
);
const IconLock = () => (
  <svg viewBox="0 0 24 24" className="lg-ic" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
const IconEye = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.5 5.4A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3-.5" strokeLinecap="round" />
  </svg>
);
const IconAlert = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16h.01" strokeLinecap="round" />
  </svg>
);

const css = `
.lg-root {
  display: grid; min-height: 100vh;
  grid-template-columns: 1fr;
  background: #F7F5F2;
  color: #1A1714;
  font-family: 'Hanken Grotesk Variable', system-ui, Arial, sans-serif;
}
@media (min-width: 1024px) { .lg-root { grid-template-columns: 1.1fr 1fr; } }

/* ---- brand side ---- */
.lg-brand {
  position: relative; isolation: isolate; overflow: hidden; display: none;
  flex-direction: column; justify-content: space-between;
  padding: 56px;
  background:
    radial-gradient(130% 120% at 0% 0%, #E7E3DA 0%, #F7F5F2 42%, #EFEDE7 100%);
}
@media (min-width: 1024px) { .lg-brand { display: flex; } }

.lg-bloom { position: absolute; border-radius: 50%; filter: blur(60px); z-index: -1; }
.lg-bloom-a { width: 460px; height: 460px; top: -120px; right: -120px;
  background: radial-gradient(circle, rgba(220,215,203,0.85), transparent 70%); }
.lg-bloom-b { width: 380px; height: 380px; bottom: -100px; left: -80px;
  background: radial-gradient(circle, rgba(185,153,25,0.10), transparent 70%);
  animation: lg-float 14s ease-in-out infinite alternate; }
@keyframes lg-float { to { transform: translate(24px, -20px); } }

.lg-drapes { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; }

/* kept static (no stacking context) so the logo's multiply blends with the cream */
.lg-brand-top, .lg-brand-mid, .lg-brand-foot { position: static; }
.lg-logo { height: 72px; width: auto; object-fit: contain; object-position: left;
  mix-blend-mode: multiply; /* drops the logo's white backdrop into the cream */
  animation: lg-rise .7s cubic-bezier(.22,1,.36,1) both; }

.lg-brand-mid { animation: lg-rise .7s .08s cubic-bezier(.22,1,.36,1) both; }
.lg-eyebrow { display: inline-block; font-size: 12px; font-weight: 600;
  letter-spacing: .22em; text-transform: uppercase; color: #8A877E; margin-bottom: 22px; }
.lg-hero { position: relative; font-size: 44px; line-height: 1.12; font-weight: 600; letter-spacing: -0.02em; margin: 0; color: #211D18; }
.lg-hero em { font-style: italic; font-weight: 600; color: #6E5A12; } /* warm gold ink */
.lg-quote { position: absolute; left: -6px; top: -38px; font-size: 110px; line-height: 1;
  color: #B99919; opacity: 0.35; font-family: Georgia, 'Times New Roman', serif; }
.lg-rule { display: block; width: 64px; height: 3px; margin-top: 30px;
  background: linear-gradient(90deg, #B99919, rgba(185,153,25,0)); border-radius: 2px; }

.lg-brand-foot { font-size: 12px; letter-spacing: .04em; color: #9B988F; }

/* ---- form side ---- */
.lg-form-wrap { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
.lg-form { width: 100%; max-width: 384px; animation: lg-rise .6s .05s cubic-bezier(.22,1,.36,1) both; }

.lg-logo-sm { height: 46px; width: auto; object-fit: contain; margin: 0 auto 34px; display: block; mix-blend-mode: multiply; }
@media (min-width: 1024px) { .lg-logo-sm { display: none; } }

.lg-head h2 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
.lg-head p { margin: 8px 0 0; font-size: 14px; color: #6B695F; }

.lg-fields { margin-top: 30px; display: flex; flex-direction: column; gap: 18px; }
.lg-field > span { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600;
  letter-spacing: .04em; color: #57554D; }

.lg-input {
  display: flex; align-items: center; gap: 11px; height: 52px; padding: 0 14px;
  background: #fff; border: 1px solid rgba(26,23,20,0.14); border-radius: 14px;
  transition: border-color .16s, box-shadow .16s, background .16s;
}
.lg-input:focus-within {
  border-color: #B99919;
  box-shadow: 0 0 0 4px rgba(185,153,25,0.14);
}
.lg-input input { flex: 1; border: 0; outline: 0; background: transparent;
  font-size: 15px; color: #1A1714; font-family: inherit; }
.lg-input input::placeholder { color: #A8A59C; }
.lg-ic { width: 18px; height: 18px; color: #8A877E; flex-shrink: 0; }

.lg-eye { display: grid; place-content: center; width: 30px; height: 30px; flex-shrink: 0;
  border: 0; background: transparent; color: #8A877E; border-radius: 8px; cursor: pointer; transition: background .15s, color .15s; }
.lg-eye:hover { background: rgba(26,23,20,0.05); color: #1A1714; }

.lg-hint { display: block; margin-top: 7px; font-size: 12px; font-weight: 600; color: #9A7B12; }

.lg-error {
  display: flex; align-items: center; gap: 9px; padding: 12px 14px;
  border: 1px solid rgba(185,62,25,0.30); background: rgba(185,62,25,0.06);
  border-radius: 12px; font-size: 13.5px; color: #B93E19;
  animation: lg-pop .35s cubic-bezier(.22,1,.36,1) both;
}

.lg-submit {
  position: relative; margin-top: 6px; height: 52px; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #26231E; color: #F7F5F2; border: 0; border-radius: 14px;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 10px 22px rgba(38,35,30,0.20);
  transition: transform .15s, box-shadow .2s, background .2s, opacity .2s;
}
.lg-submit:hover:not(:disabled) { background: #322E27; transform: translateY(-1px); box-shadow: 0 14px 28px rgba(38,35,30,0.26); }
.lg-submit:active:not(:disabled) { transform: translateY(0); }
.lg-submit:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
.lg-submit svg { transition: transform .18s; }
.lg-submit:hover:not(:disabled) svg { transform: translateX(3px); }

.lg-foot { margin-top: 26px; text-align: center; font-size: 12px; letter-spacing: .04em; color: #A8A59C; }

.lg-spin { animation: lg-rot .8s linear infinite; }
@keyframes lg-rot { to { transform: rotate(360deg); } }
@keyframes lg-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes lg-pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
`;
