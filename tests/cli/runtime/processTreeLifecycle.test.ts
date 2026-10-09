// SPDX-License-Identifier: MIT
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { executeCliPlan } from '../../../src/cli/runtime/execution';

it.skipIf(process.platform === 'win32')(
  'Stop kills a surviving descendant after the direct child closes',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-cli-tree-'));
    const heartbeat = path.join(root, 'heartbeat');
    let descendant: number | undefined;
    let reportReady!: (pid: number) => void;
    const ready = new Promise<number>(resolve => {
      reportReady = resolve;
    });
    const source = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(heartbeat)},'ready');setInterval(()=>require('node:fs').writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),20);process.send(process.pid);`;
    const parent = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(source)}],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',pid=>console.log(pid));setInterval(()=>{},1000);`;
    const pending = executeCliPlan(
      {
        displayTarget: 'tree-fixture',
        runtime: 'node',
        cwd: root,
        steps: [{ command: process.execPath, args: ['-e', parent], kind: 'execute' }],
      },
      {
        env: { PATH: process.env.PATH },
        timeoutMs: 4000,
        onStdout: chunk => reportReady(Number.parseInt(chunk, 10)),
      }
    );
    try {
      descendant = await Promise.race([
        ready,
        pending.then(() => {
          throw new Error('Fixture exited before readiness');
        }),
      ]);
      process.emit('SIGHUP');
      expect((await pending).status).toBe('stopped');
      // A heartbeat tests actual work, not kill(0), which also sees zombie PIDs.
      await new Promise(resolve => setTimeout(resolve, 100));
      const stoppedValue = await readFile(heartbeat, 'utf8');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await readFile(heartbeat, 'utf8')).toBe(stoppedValue);
    } finally {
      if (descendant) {
        try {
          process.kill(descendant, 'SIGKILL');
        } catch {
          /* Already gone. */
        }
      }
      await pending;
      await rm(root, { recursive: true, force: true });
    }
  }
);

it.skipIf(process.platform === 'win32')(
  'settles a timeout when an escaped descendant keeps output pipes open',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-cli-pipe-'));
    const pidFile = path.join(root, 'pid');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>process.exit(0),4000);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(source)}],{detached:true,stdio:['ignore',process.stdout,process.stderr]});setInterval(()=>{},1000);`;
    try {
      const result = await executeCliPlan(
        {
          displayTarget: 'pipe-fixture',
          runtime: 'node',
          cwd: root,
          steps: [{ command: process.execPath, args: ['-e', parent], kind: 'execute' }],
        },
        { env: { PATH: process.env.PATH }, timeoutMs: 500 }
      );
      expect(result.status).toBe('timeout');
      expect(result.durationMs).toBeLessThan(3000);
    } finally {
      try {
        process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        /* Already gone. */
      }
      await rm(root, { recursive: true, force: true });
    }
  }
);
