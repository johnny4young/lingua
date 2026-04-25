import { describe, it, expect } from 'vitest';
import os from 'node:os';
import {
  isPathBlocked,
  isPathWithinProject,
  isSafeEntryName,
} from '#src/main/ipc/permissions';

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
});
