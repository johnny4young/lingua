#!/usr/bin/env node
/** Serial synthetic SQL-component benchmark; no global settings or application profiles. */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--electron-executable'))
  throw new Error(
    'Usage: node scripts/profile-sql-editor-input.mjs [--electron-executable /verified/official/Electron]'
  );
const output = mkdtempSync(path.join(os.tmpdir(), 'lingua-sql-profile-'));
const report = {
  status: 'running',
  methodology: {
    repetitions: 3,
    ratesMsPerKey: [0, 125],
    cold: 'fresh Electron process and empty owned profile; OS disk caches are not flushed',
    warm: 'same process/profile, new component/model; cached code/workers',
    measuredWindow:
      'typing, then at least 650ms plus observed store save; dump serialization excluded',
    scope: 'hidden unthrottled real-component fixture, not full-app startup or visible smoothness',
    observer: 'React 19 fixture-only root observer; root commits are not component render counts',
    builds: 'one fixture build before each cold/warm pair, excluded from metrics',
    uncertainty: 'three samples per group; report median and range; no invented absolute budget',
  },
  host: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
  },
  source: Object.fromEntries(
    ['SqlMonacoEditor.tsx', 'SqlQueryEditor.tsx'].map(name => [
      name,
      createHash('sha256')
        .update(readFileSync(path.join(repo, 'src/renderer/components/SqlWorkspace', name)))
        .digest('hex'),
    ])
  ),
  runs: [],
  samples: [],
};
const summarize = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? {
        n: sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        min: sorted[0],
        max: sorted.at(-1),
      }
    : null;
};
try {
  for (const delay of [0, 125])
    for (let repetition = 1; repetition <= 3; repetition++) {
      const owned = path.join(output, `${delay}-${repetition}`);
      for (const name of ['home', 'tmp', 'cache', 'config', 'data'])
        mkdirSync(path.join(owned, name), { recursive: true });
      const env = {
        PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
        HOME: path.join(owned, 'home'),
        TMPDIR: path.join(owned, 'tmp'),
        XDG_CACHE_HOME: path.join(owned, 'cache'),
        XDG_CONFIG_HOME: path.join(owned, 'config'),
        XDG_DATA_HOME: path.join(owned, 'data'),
        LANG: 'en_US.UTF-8',
        TZ: 'UTC',
      };
      if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
      const child = spawn(
        process.execPath,
        [
          path.join(repo, 'scripts/smoke-sql-editor-input.mjs'),
          ...args,
          '--profile-pair',
          String(delay),
        ],
        { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', data => {
        stdout += data;
      });
      child.stderr.on('data', data => {
        stderr += data;
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      writeFileSync(path.join(owned, 'stdout.log'), stdout);
      writeFileSync(path.join(owned, 'stderr.log'), stderr);
      const result = JSON.parse(stdout);
      const native = JSON.parse(
        readFileSync(path.join(result.artifactDirectory, 'report.json'), 'utf8')
      );
      report.runs.push({
        delay,
        repetition,
        exitCode: code,
        status: native.status,
        nativeExit: native.nativeExit,
        errors: native.errors,
        versions: native.versions,
        artifactDirectory: result.artifactDirectory,
      });
      report.samples.push(...native.samples.map(sample => ({ ...sample, repetition })));
      if (code !== 0 || native.status !== 'passed')
        throw new Error('Native measurement failed; inspect retained report before retry');
    }
  report.groups = [];
  for (const delay of [0, 125])
    for (const cache of ['cold', 'warm']) {
      const rows = report.samples.filter(row => row.delay === delay && row.cache === cache);
      report.groups.push({
        delay,
        cache,
        exact: rows.every(row => row.exact),
        publicationBeforeNextKey: rows.every(row => row.publicationBeforeNextKey),
        typingRootCommits: summarize(rows.map(row => row.typingRootCommits)),
        settledRootCommits: summarize(rows.map(row => row.settledRootCommits)),
        settledTaskCpuMs: summarize(rows.map(row => row.settledTaskCpuMs)),
        publicationLatencyMs: summarize(
          rows.flatMap(row => row.latencies.map(item => item.latencyMs))
        ),
        missingPublications: rows.reduce(
          (count, row) => count + row.latencies.filter(item => !item.published).length,
          0
        ),
      });
    }
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        status: report.status,
        samples: report.samples.length,
        groups: report.groups,
        error: report.error,
        artifactDirectory: output,
      },
      null,
      2
    )
  );
}
