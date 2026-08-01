import { describe, expect, it, vi } from 'vitest';
import {
  loadBrunoDirectoryPreview,
  MAX_BRUNO_DIRECTORY_FILES,
} from '../../../src/renderer/hooks/brunoDirectoryImport';

function indexed(relativePath: string) {
  return {
    name: relativePath.split('/').at(-1) ?? relativePath,
    relativePath: relativePath as RelativePath,
  };
}

function makeFs() {
  return {
    selectDirectory: vi.fn().mockResolvedValue({
      canceled: false,
      rootId: 'bruno-root' as RootId,
      rootPath: '/tmp/team-api',
    }),
    listAllFiles: vi.fn(),
    stat: vi.fn().mockResolvedValue({
      size: 128,
      isDirectory: false,
      isFile: true,
      mtime: '',
      ctime: '',
    }),
    read: vi.fn(),
    revokeRoot: vi.fn().mockResolvedValue(true),
  };
}

describe('loadBrunoDirectoryPreview', () => {
  it('returns cancelled without minting work', async () => {
    const fs = makeFs();
    fs.selectDirectory.mockResolvedValue({ canceled: true });
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toEqual({ status: 'cancelled' });
    expect(fs.listAllFiles).not.toHaveBeenCalled();
    expect(fs.revokeRoot).not.toHaveBeenCalled();
  });

  it('turns a directory-picker failure into a closed reject', async () => {
    const fs = makeFs();
    fs.selectDirectory.mockRejectedValue(new Error('picker unavailable'));
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toEqual({
      status: 'rejected',
      reason: 'unsupported-feature',
      detail: 'directory-unreadable',
      sourceBytes: 0,
    });
    expect(fs.revokeRoot).not.toHaveBeenCalled();
  });

  it('loads supported requests, ignores environments and always revokes', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([
      indexed('bruno.json'),
      indexed('users/list.bru'),
      indexed('admin/create.yml'),
      indexed('environments/production.bru'),
      indexed('.env'),
      indexed('package.json'),
    ]);
    fs.read.mockImplementation(async (_rootId: RootId, path: RelativePath) => {
      if (path === 'bruno.json') return '{"name":"Team API"}';
      if (path === 'users/list.bru') {
        return 'meta {\n name: List users\n}\nget {\n url: https://api.example.com/users\n}\n';
      }
      return 'info:\n  name: Create admin\n  type: http\nhttp:\n  method: post\n  url: https://api.example.com/admins\n';
    });

    const outcome = await loadBrunoDirectoryPreview(fs);
    expect(outcome.status).toBe('previewed');
    if (outcome.status !== 'previewed') return;
    expect(outcome.preview.title).toBe('Team API');
    expect(outcome.preview.counts.total).toBe(2);
    expect(fs.read.mock.calls.map((call) => call[1])).toEqual([
      'bruno.json',
      'admin/create.yml',
      'users/list.bru',
    ]);
    expect(fs.revokeRoot).toHaveBeenCalledWith('bruno-root');
  });

  it('rejects a directory without a root manifest', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([indexed('request.bru')]);
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'directory-not-collection',
    });
    expect(fs.read).not.toHaveBeenCalled();
    expect(fs.revokeRoot).toHaveBeenCalledWith('bruno-root');
  });

  it('rejects before reads when the request-file count exceeds the cap', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([
      indexed('bruno.json'),
      ...Array.from({ length: MAX_BRUNO_DIRECTORY_FILES + 1 }, (_, index) =>
        indexed(`request-${index}.bru`)
      ),
    ]);
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'directory-too-many-files',
    });
    expect(fs.stat).not.toHaveBeenCalled();
    expect(fs.read).not.toHaveBeenCalled();
  });

  it('rejects an oversized collection before reading it', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([indexed('bruno.json'), indexed('request.bru')]);
    fs.stat.mockResolvedValue({
      size: 3 * 1024 * 1024,
      isDirectory: false,
      isFile: true,
      mtime: '',
      ctime: '',
    });
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'directory-oversized',
    });
    expect(fs.read).not.toHaveBeenCalled();
  });

  it('rechecks actual UTF-8 bytes after reads and rejects a grown file', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([indexed('bruno.json'), indexed('request.bru')]);
    fs.stat.mockResolvedValue({
      size: 1,
      isDirectory: false,
      isFile: true,
      mtime: '',
      ctime: '',
    });
    fs.read.mockImplementation(async (_rootId: RootId, path: RelativePath) =>
      path === 'bruno.json' ? '{"name":"Growing"}' : 'x'.repeat(4 * 1024 * 1024)
    );
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'directory-oversized',
    });
    expect(fs.revokeRoot).toHaveBeenCalledWith('bruno-root');
  });

  it('turns a read failure into a closed reject and revokes the root', async () => {
    const fs = makeFs();
    fs.listAllFiles.mockResolvedValue([indexed('opencollection.yml'), indexed('request.yml')]);
    fs.read.mockRejectedValue(new Error('permission denied'));
    await expect(loadBrunoDirectoryPreview(fs)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'directory-unreadable',
    });
    expect(fs.revokeRoot).toHaveBeenCalledWith('bruno-root');
  });
});
