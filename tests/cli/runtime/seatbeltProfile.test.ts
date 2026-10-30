import { describe, expect, it } from 'vitest';
import { compileSeatbeltProfile } from '../../../src/cli/runtime/seatbelt';
import { DEFAULT_REPRO_REQUEST, type ReproPolicyV1 } from '../../../src/shared/reproPolicy';

const STAGING = {
  root: '/private/var/folders/x/lingua-repro-abc',
  inputs: '/private/var/folders/x/lingua-repro-abc/inputs',
  scratch: '/private/var/folders/x/lingua-repro-abc/scratch',
  output: '/private/var/folders/x/lingua-repro-abc/output',
};
const NODE = '/Users/dev/.local/share/fnm/node-versions/v24.21.0/installation/bin/node';

function profile(policy: ReproPolicyV1 = DEFAULT_REPRO_REQUEST, staging = STAGING): string {
  return compileSeatbeltProfile({ node: NODE, staging, policy });
}

function writeRule(text: string): string {
  return text.split('\n').find(line => line.startsWith('(allow file-write*')) ?? '';
}

describe('compileSeatbeltProfile', () => {
  it('denies by default, denies every network operation and execs only the approved Node', () => {
    const text = profile();

    expect(text.split('\n').slice(0, 2)).toEqual(['(version 1)', '(deny default)']);
    expect(text).toContain('(deny network*)');
    expect(text.match(/\(allow process-exec[^\n]*/gu)).toEqual([
      `(allow process-exec (literal "${NODE}"))`,
    ]);
    expect(text).not.toContain('process-fork');
  });

  it('allows writes only to /dev/null and the approved scratch and output areas', () => {
    expect(writeRule(profile())).toBe(
      `(allow file-write* (literal "/dev/null") (subpath "${STAGING.scratch}") (subpath "${STAGING.output}"))`
    );
  });

  it('drops an area from every rule when the policy closes it', () => {
    const closed: ReproPolicyV1 = {
      ...DEFAULT_REPRO_REQUEST,
      filesystem: { ...DEFAULT_REPRO_REQUEST.filesystem, scratch: 'none', output: 'none' },
    };
    const text = profile(closed);

    expect(writeRule(text)).toBe('(allow file-write* (literal "/dev/null"))');
    expect(text).not.toContain(STAGING.scratch);
    expect(text).not.toContain(STAGING.output);
  });

  it('never grants the staged inputs write access', () => {
    expect(writeRule(profile())).not.toContain(STAGING.inputs);
  });

  it('denies metadata under user homes and volumes, then re-allows only the Node path ancestors', () => {
    const lines = profile().split('\n');
    const deny = lines.findIndex(line => line.startsWith('(deny file-read-metadata'));
    const reallow = lines.findIndex(
      (line, index) => index > deny && line.startsWith('(allow file-read-metadata (literal')
    );

    expect(lines[deny]).toBe('(deny file-read-metadata (subpath "/Users") (subpath "/Volumes"))');
    expect(reallow).toBeGreaterThan(deny);
    expect(lines[reallow]).toContain('(literal "/Users/dev/.local/share/fnm")');
    expect(lines[reallow]).toContain('(literal "/Users")');
    expect(lines[reallow]).not.toContain('(subpath "/Users');
  });

  it('escapes quotes and backslashes in paths', () => {
    const odd = { ...STAGING, inputs: '/tmp/a"b\\c/inputs' };

    expect(profile(DEFAULT_REPRO_REQUEST, odd)).toContain('(subpath "/tmp/a\\"b\\\\c/inputs")');
  });
});
