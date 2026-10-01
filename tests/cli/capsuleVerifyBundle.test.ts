import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

// prepare builds this bundle on every frozen install. This exercises the public
// argv/JSON boundary rather than calling the source dispatcher directly.
describe('built Capsule verifier', () => {
  it('qualifies pass, drift, hash refusal and unchanged replay on the built CLI', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lingua-verify-bundle-'));
    try {
      const file = path.join(root, 'baseline with spaces 漢.json');
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      const invoke = (verb: string) =>
        spawnSync(
          process.execPath,
          [path.resolve('dist/cli/lingua.cjs'), 'capsule', verb, file, '--json'],
          { encoding: 'utf8' }
        );
      writeFileSync(file, JSON.stringify(capsule));
      const pass = invoke('verify');
      expect(pass.status).toBe(0);
      expect(JSON.parse(pass.stdout)).toMatchObject({ ok: true, verdict: 'pass' });
      capsule.result.stdout = 'incorrect\n';
      writeFileSync(file, JSON.stringify(capsule));
      const drift = invoke('verify');
      expect(drift.status).toBe(5);
      expect(JSON.parse(drift.stdout)).toMatchObject({ ok: false, verdict: 'fail' });
      const replay = invoke('replay');
      expect(replay.status).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({ ok: true, comparison: { matches: false } });
      capsule.source.content = 'throw new Error("must not execute")';
      writeFileSync(file, JSON.stringify(capsule));
      const invalid = invoke('verify');
      expect(invalid.status).toBe(1);
      expect(JSON.parse(invalid.stdout)).toMatchObject({
        ok: false,
        reason: 'content-hash-mismatch',
      });
      expect(JSON.parse(invalid.stdout).run).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
