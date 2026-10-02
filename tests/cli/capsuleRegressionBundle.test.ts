import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

describe('built CLI current-target verification', () => {
  it('verifies saved targets and suites without changing a baseline oracle', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lingua-regression-bundle-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'lingua-regression-outside-'));
    try {
      const baseline = structuredClone(FIXTURE_MINIMAL_JS);
      const baselineRaw = JSON.stringify(baseline);
      const file = 'baseline with spaces 漢.json';
      const target = 'árbol con espacio.js';
      const invoke = (...args: string[]) =>
        spawnSync(
          process.execPath,
          [path.resolve('dist/cli/lingua.cjs'), 'capsule', ...args, '--json'],
          { cwd: root, encoding: 'utf8' }
        );
      writeFileSync(path.join(root, file), baselineRaw);
      writeFileSync(path.join(root, target), baseline.source.content);
      const match = invoke('verify', file, '--target', target);
      expect(match.status).toBe(0);
      expect(JSON.parse(match.stdout)).toMatchObject({
        ok: true,
        verdict: 'pass',
        sourceMode: 'current-target',
      });
      const suite = {
        kind: 'lingua-regression-suite',
        suiteVersion: 1,
        cases: [{ id: 'hello', name: 'Hello', target, baseline }],
      };
      writeFileSync(path.join(root, 'suite.json'), JSON.stringify(suite));
      expect(invoke('verify-suite', 'suite.json').status).toBe(0);
      writeFileSync(path.join(root, target), 'console.log("drift");');
      const drift = invoke('verify-suite', 'suite.json', '--root', root);
      expect(drift.status).toBe(5);
      expect(JSON.parse(drift.stdout)).toMatchObject({
        ok: false,
        verdict: 'fail',
        summary: { failed: 1 },
      });
      expect(invoke('verify', file).status).toBe(0);
      expect(readFileSync(path.join(root, file), 'utf8')).toBe(baselineRaw);
      const tampered = {
        ...baseline,
        source: { ...baseline.source, content: 'throw new Error("forbidden");' },
      };
      writeFileSync(path.join(root, file), JSON.stringify(tampered));
      const refusal = invoke('verify', file, '--target', target);
      expect(refusal.status).toBe(1);
      expect(JSON.parse(refusal.stdout).reason).toBe('content-hash-mismatch');
      expect(JSON.parse(refusal.stdout).run).toBeUndefined();
      writeFileSync(path.join(outside, 'external.js'), baseline.source.content);
      symlinkSync(
        outside,
        path.join(root, 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const escape = invoke('verify', file, '--target', 'escape/external.js');
      // Restore the oracle so the target-containment gate, not the hash, is exercised.
      writeFileSync(path.join(root, file), baselineRaw);
      const targetRefusal = invoke('verify', file, '--target', 'escape/external.js');
      expect(escape.status).toBe(1);
      expect(targetRefusal.status).toBe(1);
      expect(JSON.parse(targetRefusal.stdout).reason).toBe('invalid-regression-target');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
