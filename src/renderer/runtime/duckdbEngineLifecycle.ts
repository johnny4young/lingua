/**
 * Owns one lazy engine generation at a time. Releasing an engine is a
 * transition, not merely clearing a cache: the next factory must wait until
 * termination and any storage cleanup finish.
 */
export class DuckDbEngineLifecycle<Engine extends { terminate: (options?: { force?: boolean }) => Promise<void> }> {
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

  /** Releases only while `engine` is still the cached generation, so a late failure of an old one never drops a newer one. */
  async releaseIfCurrent(engine: Engine, options: { afterTerminate?: () => Promise<void> } = {}): Promise<void> {
    const pending = this.cached;
    if (pending === null) return;
    const current = await pending.catch(() => null);
    if (current !== engine || this.cached !== pending) return;
    await this.release(options);
  }

  release(
    options: {
      beforeTerminate?: (engine: Engine) => Promise<void>;
      afterTerminate?: () => Promise<void>;
      force?: boolean;
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
            await (options.force ? engine.terminate({ force: true }) : engine.terminate());
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
