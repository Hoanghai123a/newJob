import { useEffect, useState } from "react";

const SIGNAL_EVENT = "jobconnect:staff-cache-changed";

export function useStaffCacheSignal(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const handler = () => setV((n) => n + 1);
    window.addEventListener(SIGNAL_EVENT, handler);
    return () => window.removeEventListener(SIGNAL_EVENT, handler);
  }, []);
  return v;
}
