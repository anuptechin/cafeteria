import { createContext, useContext, useEffect, useState } from "react";

// Loads (once) the set of emp_ids that actually have a photo file on the server.
// Avatars then render a real <img> ONLY for these ids; everyone else stays as
// instant inline text — so we never fire image requests we don't need.

const PhotoCtx = createContext<Set<string>>(new Set());

export function PhotoProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/photos")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setIds(new Set(j.data as string[])); })
      .catch(() => {});
  }, []);
  return <PhotoCtx.Provider value={ids}>{children}</PhotoCtx.Provider>;
}

export const usePhotoSet = () => useContext(PhotoCtx);
