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

/** Once the panel is `ready`, answers a pending ask with `create`; a null `create` drops the ask. */
export function useSqlSampleRequest(ready: boolean, create: (() => Promise<void>) | null): void {
  useEffect(() => {
    if (ready && consumeSqlSampleRequest()) void create?.();
  }, [ready, create]);
}
