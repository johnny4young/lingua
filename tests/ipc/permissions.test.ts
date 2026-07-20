import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BLOCKED_PATH_FAMILIES,
  blockedPathFamily,
  isPathBlocked,
  isPathWithinProject,
  isSafeEntryName,
  registerBlockedPaths,
  resetRegisteredBlockedPaths,
} from '#src/main/ipc/permissions';
import { FS_BLOCKED_FAMILIES } from '#src/shared/telemetry';

const home = os.homedir();

afterEach(() => {
  // Drop any runtime-registered paths so the `registerBlockedPaths` cases do
  // not leak into the static-denylist cases.
  resetRegisteredBlockedPaths();
});

describe('isPathBlocked', () => {
  it('returns false for a normal home directory path not in BLOCKED_PATHS', () => {
    const normalPath = `${os.homedir()}/Documents/project/main.go`;
    expect(isPathBlocked(normalPath, 'read')).toBe(false);
    expect(isPathBlocked(normalPath, 'write')).toBe(false);
    expect(isPathBlocked(normalPath, 'delete')).toBe(false);
  });

  it('returns true for /etc/passwd (read)', () => {
    expect(isPathBlocked('/etc/passwd', 'read')).toBe(true);
  });

  it('returns true for /etc/passwd (write)', () => {
    expect(isPathBlocked('/etc/passwd', 'write')).toBe(true);
  });

  it('returns true for /etc/passwd (delete)', () => {
    expect(isPathBlocked('/etc/passwd', 'delete')).toBe(true);
  });

  it('returns true for a path inside a blocked directory (/etc/nginx/nginx.conf)', () => {
    expect(isPathBlocked('/etc/nginx/nginx.conf', 'read')).toBe(true);
  });

  it('returns true for ~/.ssh/id_rsa', () => {
    const sshKey = `${os.homedir()}/.ssh/id_rsa`;
    expect(isPathBlocked(sshKey, 'read')).toBe(true);
    expect(isPathBlocked(sshKey, 'write')).toBe(true);
    expect(isPathBlocked(sshKey, 'delete')).toBe(true);
  });

  it('returns false for a random temp path /tmp/myproject/main.go', () => {
    expect(isPathBlocked('/tmp/myproject/main.go', 'read')).toBe(false);
    expect(isPathBlocked('/tmp/myproject/main.go', 'write')).toBe(false);
    expect(isPathBlocked('/tmp/myproject/main.go', 'delete')).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    'matches Windows blocks case-insensitively',
    () => {
      expect(isPathBlocked('c:\\windows\\system32', 'write')).toBe(true);
      expect(isPathBlocked('C:\\WINDOWS\\System32', 'delete')).toBe(true);
    }
  );

  it.runIf(process.platform === 'win32')(
    'rejects Windows device-namespace and UNC prefixes that would skip the block',
    () => {
      expect(isPathBlocked('\\\\?\\C:\\Windows\\System32', 'write')).toBe(true);
      expect(isPathBlocked('\\\\.\\C:\\Windows\\System32', 'delete')).toBe(true);
    }
  );
});

// implementation detail — one positive + one negative case per blocked family,
// plus the family the matcher reports. Paths are built with `path.join(home,
// ...)` so the matrix runs on the CI OS without mocking: every static entry is
// present on every platform (entries for other OSes simply never match a real
// path), so a `home`-relative path matches its entry regardless of runner.
describe('blocked-path families (internal coverage matrix)', () => {
  const FAMILY_CASES = [
    {
      family: 'system' as const,
      blocked: '/etc/nginx/nginx.conf',
      // A sibling that shares the textual prefix but is NOT inside /etc.
      allowed: '/etcetera/notes.txt',
    },
    {
      family: 'credentials' as const,
      blocked: path.join(home, '.ssh', 'id_rsa'),
      // False-prefix boundary: `.sshconfig` must NOT be caught by the `.ssh`
      // entry (segment-prefix match requires a separator).
      allowed: path.join(home, '.sshconfig'),
    },
    {
      family: 'credentials' as const,
      blocked: path.join(home, '.aws', 'credentials'),
      allowed: path.join(home, 'Documents', 'aws-notes.md'),
    },
    {
      family: 'app-data' as const,
      blocked: path.join(home, 'Library', 'Application Support', 'SomeApp', 'state.json'),
      // Sibling under Library that is not one of the blocked app-data roots.
      allowed: path.join(home, 'Library', 'MyOwnFolder', 'file.txt'),
    },
    {
      family: 'browser-profile' as const,
      // Matches only the browser-profile entry (not under Application Support).
      blocked: path.join(home, '.config', 'google-chrome', 'Default', 'Cookies'),
      allowed: path.join(home, '.config', 'my-own-app', 'config.json'),
    },
  ];

  for (const { family, blocked, allowed } of FAMILY_CASES) {
    it(`blocks ${family}: ${blocked}`, () => {
      expect(isPathBlocked(blocked, 'read')).toBe(true);
      expect(blockedPathFamily(blocked)).toBe(family);
    });

    it(`allows the ${family} sibling: ${allowed}`, () => {
      expect(isPathBlocked(allowed, 'read')).toBe(false);
      expect(blockedPathFamily(allowed)).toBeNull();
    });
  }

  it('escapes regex metacharacters are not relevant but dots in family names stay tokens', () => {
    // Every family token is a telemetry-safe lowercase token.
    for (const family of BLOCKED_PATH_FAMILIES) {
      expect(family).toMatch(/^[a-z][a-z-]*$/u);
    }
  });
});

// implementation note — Lingua's own electron-owned dirs are registered at
// startup so renderer-initiated reads/writes cannot reach them. Symlink-escape
// is intentionally NOT handled in the lexical denylist; it is covered at the
// capability chokepoint (realpath + containment + denylist) — see the symlink
// cases in tests/ipc/fileSystem.test.ts.
describe('registerBlockedPaths (Lingua data dirs)', () => {
  it('blocks a runtime-registered path and reports the lingua-data family', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-userdata-'));
    try {
      expect(isPathBlocked(path.join(dir, 'settings.json'), 'write')).toBe(false);
      registerBlockedPaths([dir]);
      expect(isPathBlocked(path.join(dir, 'settings.json'), 'write')).toBe(true);
      expect(blockedPathFamily(path.join(dir, 'nested', 'cache.db'))).toBe('lingua-data');
      // A sibling outside the registered dir stays allowed.
      expect(isPathBlocked(`${dir}-other/file.txt`, 'write')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent for the same registered path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-userdata-'));
    try {
      registerBlockedPaths([dir]);
      registerBlockedPaths([dir]);
      expect(isPathBlocked(path.join(dir, 'x'), 'read')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// implementation note — the telemetry family set must stay in lockstep
// with the main-process source of truth so the privacy-safe `fs.blocked` signal
// never accepts a family the denylist cannot produce (and vice versa).
describe('FS_BLOCKED_FAMILIES telemetry parity', () => {
  it('matches BLOCKED_PATH_FAMILIES from permissions.ts exactly', () => {
    expect([...FS_BLOCKED_FAMILIES].sort()).toEqual([...BLOCKED_PATH_FAMILIES].sort());
  });
});

describe('isPathWithinProject', () => {
  const projectRoot = '/home/user/proj';

  it('returns true for the project root itself', () => {
    expect(isPathWithinProject(projectRoot, projectRoot)).toBe(true);
  });

  it('returns true for a file directly inside the project root', () => {
    expect(isPathWithinProject(`${projectRoot}/main.go`, projectRoot)).toBe(true);
  });

  it('returns true for a deeply nested file inside the project root', () => {
    expect(isPathWithinProject(`${projectRoot}/src/utils/helpers/strings.go`, projectRoot)).toBe(true);
  });

  it('returns false for a sibling directory (same parent, different name)', () => {
    expect(isPathWithinProject('/home/user/other', projectRoot)).toBe(false);
  });

  it('returns false for a path that starts with the project root string but is not inside it', () => {
    // /home/user/projextra/file starts with /home/user/proj but is NOT inside /home/user/proj
    expect(isPathWithinProject('/home/user/projextra/file', projectRoot)).toBe(false);
  });
});

describe('isSafeEntryName', () => {
  it('allows simple filenames and folder names', () => {
    expect(isSafeEntryName('main.go')).toBe(true);
    expect(isSafeEntryName('src')).toBe(true);
  });

  it('rejects empty and traversal names', () => {
    expect(isSafeEntryName('')).toBe(false);
    expect(isSafeEntryName('.')).toBe(false);
    expect(isSafeEntryName('..')).toBe(false);
  });

  it('rejects path separators', () => {
    expect(isSafeEntryName('../escape')).toBe(false);
    expect(isSafeEntryName('nested/file.ts')).toBe(false);
    expect(isSafeEntryName('nested\\file.ts')).toBe(false);
  });

  it('rejects NUL bytes', () => {
    expect(isSafeEntryName('bad\0name.txt')).toBe(false);
  });
});
