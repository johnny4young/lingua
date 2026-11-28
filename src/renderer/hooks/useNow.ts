import { useEffect, useState } from 'react';

const TICK_MS = 100;
const NO_RESET = Symbol('no reset');

/** A clock that ticks every 100 ms (or `tickMs`) while `active` and holds its last reading otherwise; `reset` reads it again at once. */
export function useNow(active: boolean, read: () => number = Date.now, tickMs = TICK_MS, reset: unknown = NO_RESET): number {
  const [now, setNow] = useState(read);
  useEffect(() => {
    if (active && reset !== NO_RESET) setNow(read());
  }, [active, read, reset]);
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => setNow(read()), tickMs);
    return () => clearInterval(handle);
  }, [active, read, tickMs]);
  return now;
}
