/**
 * Owns one lazy engine generation at a time. Releasing an engine is a
 * transition, not merely clearing a cache: the next factory must wait until
 * termination and any storage cleanup finish.
 */
export class DuckDbEngineLifecycle<Engine extends { terminate: () => Promise<void> }> {
  private cached: Promise<Engine> | null = null;
  private releaseBarrier: Promise<void> = Promise.resolve();

  constructor(private readonly factory: () => Promise<Engine>) {}

  get(): Promise<Engine> {
    if (this.cached !== null) return this.cached;

    const pending = this.releaseBarrier.then(this.factory);
    const current = pending.catch(error => {
      // A failed generation may settle after release has made room for the
      // next one. It must never clear that newer engine's cache entry.
      if (this.cached === current) this.cached = null;
      throw error;
    });
    this.cached = current;
    return current;
  }

  release(
    options: {
      beforeTerminate?: (engine: Engine) => Promise<void>;
      afterTerminate?: () => Promise<void>;
    } = {}
  ): Promise<void> {
    const pending = this.cached;
    this.cached = null;
    const transition = this.releaseBarrier.then(async () => {
      if (pending !== null) {
        try {
          const engine = await pending;
          try {
            await options.beforeTerminate?.(engine);
          } catch {
            // A failed best-effort checkpoint must not prevent termination.
          }
          try {
            await engine.terminate();
          } catch {
            // A rejected instantiate or already-terminated engine is gone.
          }
        } catch {
          // Failed factory: there is no engine to terminate.
        }
      }
      await options.afterTerminate?.();
    });
    // A failed cleanup must not poison all later user-driven retries.
    this.releaseBarrier = transition.then(
      () => undefined,
      () => undefined
    );
    return transition;
  }
}
