import { useEffect } from 'react';

/** One-shot ask, from outside the lazy SQL panel, to create the sample table once its catalog loads. */
let requested = false;

export function requestSqlSample(): void {
  requested = true;
}

export function consumeSqlSampleRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}

/** Runs `create` once the panel is `ready` if a sample was asked for. */
export function useSqlSampleRequest(ready: boolean, create: () => Promise<void>): void {
  useEffect(() => {
    if (ready && consumeSqlSampleRequest()) void create();
  }, [ready, create]);
}
