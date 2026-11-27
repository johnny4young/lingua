import { useEffect, useState } from 'react';

const TICK_MS = 100;

/** A clock that ticks every 100 ms while `active` and holds its last reading otherwise. */
export function useNow(active: boolean, read: () => number = Date.now): number {
  const [now, setNow] = useState(read);
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => setNow(read()), TICK_MS);
    return () => clearInterval(handle);
  }, [active, read]);
  return now;
}
