const num = new Intl.NumberFormat("en-IN");

export const count = (n: number) => num.format(n ?? 0);

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

export const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

export const dayLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

export const ago = (iso: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
};

export const faceUrl = (empId: string, name = "") =>
  `/faces/${empId}.svg${name ? `?n=${encodeURIComponent(name)}` : ""}`;

// Real names can be very long ("Binod Dewendra Pandey Pandey"). Show first + last.
export const shortName = (name: string) => {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (p.length <= 2) return (name || "").trim();
  return `${p[0]} ${p[p.length - 1]}`;
};

export const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
};
