// SPDX-License-Identifier: MIT
/**
 * macOS Seatbelt backend (`sandbox-exec`) for permissioned reproductions.
 *
 * The profile denies everything, then allows exactly the Node binary, the OS
 * libraries it loads, file metadata outside user homes and external volumes,
 * reads of the staged inputs, and writes to scratch and output only when the
 * policy approves them. The kernel applies it to the process and every
 * descendant. Denials are not observable from here, so evidence is unavailable.
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import type { ReproBackendProbe, ReproPolicyV1 } from '../../shared/reproPolicy';
import { truncateUtf8, utf8ByteLength } from '../../shared/utf8';
import type {
  ReproContainmentBackend,
  ReproLaunchOutcome,
  ReproLaunchRequest,
} from './containment';
import { executeCliPlan, type CliExecutionResult } from './execution';
import type { ReproStaging } from './reproStaging';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SYSTEM_READ_SUBPATHS = [
  '/usr/lib',
  '/System/Library',
  '/System/Volumes/Preboot/Cryptexes/OS',
  '/private/var/db/dyld',
];
const DEVICE_READ_LITERALS = ['/dev/null', '/dev/random', '/dev/urandom'];
// Metadata stays readable elsewhere because Node's startup stats paths we cannot enumerate.
const METADATA_DENIED_SUBPATHS = ['/Users', '/Volumes'];

export const SEATBELT_AMBIENT_GRANTS: readonly string[] = [
  'exec and read the approved Node.js binary',
  ...SYSTEM_READ_SUBPATHS.map(subpath => `read ${subpath}`),
  ...DEVICE_READ_LITERALS.map(literal => `read ${literal}`),
  'write /dev/null',
  'list /',
  `read file metadata outside ${METADATA_DENIED_SUBPATHS.join(' and ')}`,
  'read sysctl values',
];

/** SBPL string literal; JSON escaping matches the profile reader's quote and backslash rules. */
function quote(value: string): string {
  return JSON.stringify(value);
}

function ancestors(target: string): string[] {
  const chain: string[] = [];
  for (let current = target; ; current = path.dirname(current)) {
    chain.push(current);
    if (path.dirname(current) === current) return chain;
  }
}

export function compileSeatbeltProfile(input: {
  node: string;
  staging: Pick<ReproStaging, 'root' | 'inputs' | 'scratch' | 'output'>;
  policy: ReproPolicyV1;
}): string {
  const { node, staging, policy } = input;
  const writable = (['scratch', 'output'] as const)
    .filter(area => policy.filesystem[area] === 'read-write')
    .map(area => staging[area]);
  const metadataAllowed = [...new Set([...ancestors(node), ...ancestors(staging.root)])];
  return [
    '(version 1)',
    '(deny default)',
    `(allow process-exec (literal ${quote(node)}))`,
    '(allow sysctl-read)',
    '(allow file-read*',
    `  (literal "/") (literal ${quote(node)})`,
    ...SYSTEM_READ_SUBPATHS.map(subpath => `  (subpath ${quote(subpath)})`),
    ...DEVICE_READ_LITERALS.map(literal => `  (literal ${quote(literal)})`),
    ...[staging.inputs, ...writable].map(area => `  (subpath ${quote(area)})`),
    ')',
    '(allow file-read-metadata)',
    `(deny file-read-metadata ${METADATA_DENIED_SUBPATHS.map(subpath => `(subpath ${quote(subpath)})`).join(' ')})`,
    `(allow file-read-metadata ${metadataAllowed.map(entry => `(literal ${quote(entry)})`).join(' ')}`,
    ...[staging.inputs, ...writable].map(area => `  (subpath ${quote(area)})`),
    ')',
    `(allow file-write* (literal "/dev/null")${writable.map(area => ` (subpath ${quote(area)})`).join('')})`,
    '(deny network*)',
    '',
  ].join('\n');
}

function clip(result: CliExecutionResult, maxBytes: number): CliExecutionResult {
  const stdoutClipped = utf8ByteLength(result.stdout) > maxBytes;
  const stderrClipped = utf8ByteLength(result.stderr) > maxBytes;
  if (!stdoutClipped && !stderrClipped) return result;
  return {
    ...result,
    stdout: stdoutClipped ? truncateUtf8(result.stdout, maxBytes) : result.stdout,
    stderr: stderrClipped ? truncateUtf8(result.stderr, maxBytes) : result.stderr,
    truncated: {
      stdout: stdoutClipped || (result.truncated?.stdout ?? false),
      stderr: stderrClipped || (result.truncated?.stderr ?? false),
    },
  };
}

async function sandboxExecWorks(): Promise<boolean> {
  try {
    await access(SANDBOX_EXEC, constants.X_OK);
  } catch {
    return false;
  }
  return new Promise(resolve => {
    execFile(
      SANDBOX_EXEC,
      ['-p', '(version 1)(allow default)', '/usr/bin/true'],
      { timeout: 5_000, env: {} },
      error => resolve(!error)
    );
  });
}

async function probe(): Promise<ReproBackendProbe | null> {
  if (process.platform !== 'darwin' || !(await sandboxExecWorks())) return null;
  return {
    backend: { id: seatbeltBackend.id, version: '1' },
    controls: {
      'filesystem-isolation': 'enforced',
      'network-deny': 'enforced',
      'process-containment': 'enforced',
      'wall-clock-limit': 'enforced',
      'output-limit': 'enforced',
      // Fork is denied outright, so the workload is always a single process.
      'process-limit': 'enforced',
      'memory-limit': 'unsupported',
      'disk-limit': 'unsupported',
      'denial-evidence': 'unsupported',
    },
    ambientGrants: SEATBELT_AMBIENT_GRANTS,
  };
}

async function launch(request: ReproLaunchRequest): Promise<ReproLaunchOutcome> {
  const { staging, policy, node } = request;
  const cwd = policy.filesystem.scratch === 'read-write' ? staging.scratch : staging.inputs;
  const startedAt = new Date();
  const result = await executeCliPlan(
    {
      displayTarget: path.basename(staging.entry),
      runtime: `node ${node.version}`,
      cwd,
      steps: [
        {
          command: SANDBOX_EXEC,
          args: [
            '-p',
            compileSeatbeltProfile({ node: node.path, staging, policy }),
            node.path,
            staging.entry,
            ...request.args,
          ],
          kind: 'execute',
        },
      ],
    },
    {
      env: { HOME: cwd, TMPDIR: cwd },
      timeoutMs: policy.limits.wallClockMs,
      ...(request.stdin !== undefined ? { stdin: request.stdin } : {}),
    }
  );
  return {
    result: clip(result, policy.limits.outputBytes),
    startedAt,
    endedAt: new Date(),
    evidence: { coverage: 'unavailable', denials: [] },
  };
}

export const seatbeltBackend: ReproContainmentBackend = { id: 'macos-seatbelt', probe, launch };
