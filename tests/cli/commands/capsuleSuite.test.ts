import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, symlink, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dispatch } from '../../../src/cli/lingua';
import { runVerifyCapsuleCommand } from '../../../src/cli/commands/capsuleVerify';
import { computeContentHash } from '../../../src/shared/runCapsule';
import {
  parseCapsuleRegressionSuite,
  MAX_REGRESSION_SUITE_BYTES,
} from '../../../src/shared/capsuleRegressionSuite';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { createDefaultIo } from '../../../src/cli/io';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lingua-case-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const baseline = () => structuredClone(FIXTURE_MINIMAL_JS);
const suite = (
  cases = [{ id: 'hello', name: 'Hello output', target: 'hello.js', baseline: baseline() }]
) => ({ kind: 'lingua-regression-suite', suiteVersion: 1, cases });
async function command(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await dispatch(args, {
    ...createDefaultIo(),
    stdoutSupportsColor: false,
    stderrSupportsColor: false,
    writeStdout: text => {
      stdout += text;
    },
    writeStderr: text => {
      stderr += text;
    },
  });
  return { code, body: JSON.parse(stdout), stderr };
}
async function runSuite(value = suite()) {
  const file = path.join(dir, 'suite.json');
  await writeFile(file, JSON.stringify(value));
  return command(['capsule', 'verify-suite', file, '--root', dir, '--json']);
}
describe('current-target regression cases', () => {
  it('runs current bytes rather than rewriting or replaying the baseline', async () => {
    await writeFile(path.join(dir, 'hello.js'), baseline().source.content);
    expect((await runSuite()).body).toMatchObject({
      ok: true,
      verdict: 'pass',
      summary: { total: 1, passed: 1 },
      cases: [{ sourceMode: 'current-target', comparison: { matches: true } }],
    });
    await writeFile(path.join(dir, 'hello.js'), 'console.log("changed")');
    const result = await runSuite();
    expect(result.code).toBe(5);
    expect(result.body).toMatchObject({
      ok: false,
      verdict: 'fail',
      cases: [{ comparison: { stdout: false } }],
    });
    expect(
      JSON.parse(await readFile(path.join(dir, 'suite.json'), 'utf8')).cases[0].baseline.source
    ).toEqual(baseline().source);
  });
  it('forwards baseline argv and stdin without duplicate expectations', async () => {
    const b = baseline();
    const code =
      'process.stdin.setEncoding("utf8"); let s=""; process.stdin.on("data", x => s+=x); process.stdin.on("end",()=>console.log(process.argv.slice(1).join("|")+":"+s));';
    b.source = { content: code, contentHash: await computeContentHash(code) };
    b.input = { stdin: 'input', args: ['a b', 'ñ'] };
    b.result.stdout = 'a b|ñ:input\n';
    await writeFile(path.join(dir, 'árbol con espacio.js'), code);
    expect(
      (
        await runSuite(
          suite([{ id: 'stdin', name: 'Arguments', target: 'árbol con espacio.js', baseline: b }])
        )
      ).body.ok
    ).toBe(true);
  });
  it('rejects every invalid baseline before any spawn', async () => {
    const marker = path.join(dir, 'ran');
    const b = baseline();
    b.source.content += '\nchanged';
    await writeFile(
      path.join(dir, 'hello.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`
    );
    const result = await runSuite(
      suite([
        { id: 'first', name: 'First', target: 'hello.js', baseline: baseline() },
        { id: 'bad', name: 'Bad', target: 'hello.js', baseline: b },
      ])
    );
    expect(result.code).toBe(1);
    expect(result.body.reason).toBe('content-hash-mismatch');
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['../outside.js', '/outside.js', 'C:\\outside.js', 'nested/../../outside.js'])(
    'rejects unsafe target %s before executing',
    async target => {
      const result = await runSuite(
        suite([{ id: 'bad', name: 'Bad', target, baseline: baseline() }])
      );
      expect(result.code).toBe(1);
      expect(result.body.ok).toBe(false);
    }
  );
  it('rejects an escaping symlink and an incompatible type', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'lingua-outside-'));
    try {
      await writeFile(path.join(outside, 'out.js'), baseline().source.content);
      await symlink(path.join(outside, 'out.js'), path.join(dir, 'hello.js'));
      expect((await runSuite()).code).toBe(1);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    await writeFile(path.join(dir, 'hello.py'), baseline().source.content);
    expect(
      (
        await runSuite(
          suite([{ id: 'type', name: 'Type', target: 'hello.py', baseline: baseline() }])
        )
      ).code
    ).toBe(1);
  });
  it('refuses empty, oversized and duplicate-id artifacts', () => {
    expect(parseCapsuleRegressionSuite(JSON.stringify(suite([]))).ok).toBe(false);
    expect(parseCapsuleRegressionSuite(' '.repeat(MAX_REGRESSION_SUITE_BYTES + 1))).toEqual({
      ok: false,
      reason: 'suite-too-large',
    });
    expect(
      parseCapsuleRegressionSuite(
        JSON.stringify(
          suite(
            Array.from({ length: 21 }, (_, i) => ({
              id: String(i),
              name: 'case',
              target: 'hello.js',
              baseline: baseline(),
            }))
          )
        )
      ).ok
    ).toBe(false);
    expect(
      parseCapsuleRegressionSuite(JSON.stringify(suite([suite().cases[0]!, suite().cases[0]!]))).ok
    ).toBe(false);
  });
  it('consumes bounded files and never executes malformed suites', async () => {
    const file = path.join(dir, 'large.json');
    await writeFile(file, ' '.repeat(MAX_REGRESSION_SUITE_BYTES + 1));
    expect((await command(['capsule', 'verify-suite', file, '--json'])).body.reason).toBe(
      'suite-too-large'
    );
  });
  it('accepts exact UTF-8 byte and case limits, rejects the next byte and unknown fields', () => {
    const artifact = suite(
      Array.from({ length: 20 }, (_, i) => ({
        id: `case-${i}`,
        name: 'ñ 漢',
        target: 'hello.js',
        baseline: baseline(),
      }))
    );
    const raw = JSON.stringify(artifact);
    const exact = raw + ' '.repeat(MAX_REGRESSION_SUITE_BYTES - Buffer.byteLength(raw));
    expect(Buffer.byteLength(exact)).toBe(MAX_REGRESSION_SUITE_BYTES);
    expect(parseCapsuleRegressionSuite(exact).ok).toBe(true);
    expect(parseCapsuleRegressionSuite(exact + ' ').ok).toBe(false);
    expect(parseCapsuleRegressionSuite(JSON.stringify({ ...artifact, hook: 'unsafe' })).ok).toBe(
      false
    );
    expect(
      parseCapsuleRegressionSuite(
        JSON.stringify({
          ...artifact,
          cases: [{ ...artifact.cases[0], expected: 'duplicate oracle' }],
        })
      ).ok
    ).toBe(false);
  });
  it('rejects a later invalid target before executing an earlier valid one', async () => {
    const marker = path.join(dir, 'ran');
    await writeFile(
      path.join(dir, 'hello.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`
    );
    const result = await runSuite(
      suite([
        { id: 'first', name: 'First', target: 'hello.js', baseline: baseline() },
        { id: 'missing', name: 'Missing', target: 'missing.js', baseline: baseline() },
      ])
    );
    expect(result.code).toBe(1);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports confirmed drift even when another case is inconclusive', async () => {
    await writeFile(path.join(dir, 'hello.js'), 'console.log("changed")');
    await writeFile(path.join(dir, 'other.py'), 'print(3)');
    const divergent = baseline();
    divergent.tab.language = 'python';
    divergent.source = { content: 'print(3)', contentHash: await computeContentHash('print(3)') };
    const result = await runSuite(
      suite([
        { id: 'drift', name: 'Drift', target: 'hello.js', baseline: baseline() },
        { id: 'engine', name: 'Engine', target: 'other.py', baseline: divergent },
      ])
    );
    expect(result.code).toBe(5);
    expect(result.body).toMatchObject({
      verdict: 'fail',
      summary: { failed: 1, inconclusive: 1 },
    });
  });
  it('executes target bytes in the baseline runtime mode', async () => {
    const source = 'console.log(await Promise.resolve(3));';
    const awaited = baseline();
    awaited.source = { content: source, contentHash: await computeContentHash(source) };
    awaited.result.stdout = '3\n';
    await writeFile(path.join(dir, 'hello.js'), source);
    const result = await runSuite(
      suite([{ id: 'await', name: 'Await', target: 'hello.js', baseline: awaited }])
    );
    expect(result.body).toMatchObject({ verdict: 'pass' });
    expect(result.code).toBe(0);
  });
  it('keeps the captured working directory rather than the target folder', async () => {
    const source = 'console.log(process.cwd() === process.env.LINGUA_TARGET_DIR);';
    const located = baseline();
    located.source = { content: source, contentHash: await computeContentHash(source) };
    located.result.stdout = 'false\n';
    await mkdir(path.join(dir, 'nested'));
    await writeFile(path.join(dir, 'nested', 'hello.js'), source);
    const file = path.join(dir, 'suite.json');
    await writeFile(
      file,
      JSON.stringify(
        suite([{ id: 'cwd', name: 'Cwd', target: 'nested/hello.js', baseline: located }])
      )
    );
    const result = await command([
      'capsule',
      'verify-suite',
      file,
      '--root',
      dir,
      '--env',
      `LINGUA_TARGET_DIR=${await realpath(path.join(dir, 'nested'))}`,
      '--json',
    ]);
    expect(result.body).toMatchObject({ verdict: 'pass' });
  });
  it.each(['notes.txt', 'folder.js'])(
    'refuses an incompatible %s target as invalid input',
    async target => {
      await writeFile(path.join(dir, 'notes.txt'), 'text');
      await mkdir(path.join(dir, 'folder.js'));
      const file = path.join(dir, 'case.json');
      await writeFile(file, JSON.stringify(baseline()));
      let stdout = '';
      const code = await runVerifyCapsuleCommand(
        {
          filePath: file,
          targetPath: target,
          rootDirectory: dir,
          env: [],
          json: true,
          quiet: false,
        },
        { ...createDefaultIo(), writeStdout: text => void (stdout += text), writeStderr: () => {} }
      );
      const result = { code, body: JSON.parse(stdout) };
      expect(result.code).toBe(1);
      expect(result.body.reason).toBe('invalid-regression-target');
    }
  );
});
