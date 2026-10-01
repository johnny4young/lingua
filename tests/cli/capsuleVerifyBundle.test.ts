import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { describeIfBundle, runCli } from './cliBundle';

// Exercises the public argv/JSON boundary rather than the source dispatcher.
describeIfBundle('built Capsule verifier', () => {
  it('qualifies pass, drift, hash refusal and unchanged replay on the built CLI', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lingua-verify-bundle-'));
    try {
      const file = path.join(root, 'baseline with spaces 漢.json');
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      const invoke = (verb: string) => runCli(['capsule', verb, file, '--json']);
      writeFileSync(file, JSON.stringify(capsule));
      const pass = invoke('verify');
      expect(pass.code).toBe(0);
      expect(JSON.parse(pass.stdout)).toMatchObject({ ok: true, verdict: 'pass' });
      capsule.result.stdout = 'incorrect\n';
      writeFileSync(file, JSON.stringify(capsule));
      const drift = invoke('verify');
      expect(drift.code).toBe(5);
      expect(JSON.parse(drift.stdout)).toMatchObject({ ok: false, verdict: 'fail' });
      const replay = invoke('replay');
      expect(replay.code).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({ ok: true, comparison: { matches: false } });
      capsule.source.content = 'throw new Error("must not execute")';
      writeFileSync(file, JSON.stringify(capsule));
      const invalid = invoke('verify');
      expect(invalid.code).toBe(1);
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
