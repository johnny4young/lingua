import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as realSetTimeout } from 'node:timers';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const sleep = (ms: number) => new Promise(resolve => realSetTimeout(resolve, ms));

// exitCode null keeps the parent alive past the deadline; elapsedMs is how long
// the install ran before the parent exits.
it.skipIf(process.platform === 'win32').each([
  { exitCode: null, elapsedMs: 0 },
  { exitCode: 0, elapsedMs: 0 },
  { exitCode: 0, elapsedMs: 299_000 },
  { exitCode: 3, elapsedMs: 0 },
])(
  'settles an install whose output pipes escaped (parent exit $exitCode after $elapsedMs ms)',
  async ({ exitCode, elapsedMs }) => {
    const { installNativeDependencies } = await import('../../src/main/nativeDependencyInstall');
    let reportReady!: (pid: number) => void;
    const ready = new Promise<number>(resolve => {
      reportReady = resolve;
    });
    const descendantSource = `process.send(process.pid);setInterval(()=>{},1000);`;
    const parentSource = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{detached:true,stdio:['ignore',process.stdout,process.stderr,'ipc']});c.on('message',pid=>console.log(pid));process.on('SIGUSR2',()=>process.exit(${exitCode ?? 0}));setInterval(()=>{},1000);`;
    let descendant: number | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let parentExit!: Promise<unknown[]>;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = installNativeDependencies({
      language: 'go',
      specifiers: ['github.com/gin-gonic/gin'],
      cwd: process.cwd(),
      skipManifestCheck: true,
      platform: 'linux',
      spawnImpl: ((_command, _args, options) => {
        const launched = spawn(process.execPath, ['-e', parentSource], options ?? {});
        child = launched;
        parentExit = once(launched, 'exit');
        launched.stdout!.once('data', chunk => reportReady(Number.parseInt(chunk.toString(), 10)));
        return child;
      }) as typeof spawn,
    });
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    try {
      descendant = await Promise.race([
        ready,
        sleep(3000).then(() => {
          throw new Error('Fixture readiness timeout');
        }),
      ]);
      if (exitCode !== null) {
        await vi.advanceTimersByTimeAsync(elapsedMs);
        process.kill(child!.pid!, 'SIGUSR2');
        await parentExit;
        // A finished installer settles by exit code once the bounded drain
        // ends, even when that drain outlasts the install deadline.
        await vi.advanceTimersByTimeAsync(1999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toMatchObject({
          status: exitCode === 0 ? 'success' : 'error',
          exitCode,
        });
        expect(child!.stdout!.destroyed).toBe(true);
        expect(child!.stderr!.destroyed).toBe(true);
        return;
      }
      await vi.advanceTimersByTimeAsync(300000);
      await Promise.race([
        parentExit,
        sleep(3000).then(() => {
          throw new Error('Parent failed to exit');
        }),
      ]);
      await vi.advanceTimersByTimeAsync(201);
      expect(settled).toBe(true);
      expect(child!.stdout!.destroyed).toBe(true);
      expect(child!.stderr!.destroyed).toBe(true);
      await expect(pending).resolves.toMatchObject({ status: 'timeout' });
      // The escaped process is outside the group; bounded completion is not containment.
      expect(() => process.kill(descendant!, 0)).not.toThrow();
    } finally {
      if (descendant) {
        try {
          process.kill(descendant, 'SIGKILL');
        } catch {
          /* Already gone. */
        }
      }
      if (child?.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already gone. */
        }
      }
      vi.useRealTimers();
      await pending;
    }
  },
  10000
);
