import { load as parseYaml } from 'js-yaml';
import {
  previewBrunoDirectory,
  type BrunoDirectoryFile,
} from '../../shared/importers/brunoImporter';
import {
  MAX_COLLECTION_BYTES,
  type CollectionImporterPreview,
} from '../../shared/importers/postmanImporter';
import type { BrunoRejectReason, ImporterRejectReason } from '../../shared/importers/types';
import { utf8ByteLength } from '../../shared/httpWorkspaceSchema';

export const MAX_BRUNO_DIRECTORY_FILES = 500;

type BrunoDirectoryFs = Pick<
  LinguaAPI['fs'],
  'selectDirectory' | 'listAllFiles' | 'stat' | 'read' | 'revokeRoot'
>;

export type BrunoDirectoryImportOutcome =
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'previewed';
      readonly preview: CollectionImporterPreview;
      readonly sourceBytes: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ImporterRejectReason;
      readonly detail: BrunoRejectReason;
      readonly sourceBytes: number;
    };

function reject(detail: BrunoRejectReason, sourceBytes = 0): BrunoDirectoryImportOutcome {
  const reason: ImporterRejectReason =
    detail === 'directory-too-many-files' ||
    detail === 'directory-oversized' ||
    detail === 'directory-unreadable'
      ? 'unsupported-feature'
      : 'malformed';
  return { status: 'rejected', reason, detail, sourceBytes };
}

function isRequestCandidate(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const lowerParts = parts.map(part => part.toLowerCase());
  const base = lowerParts.at(-1) ?? '';
  if (lowerParts.some(part => part.startsWith('.'))) return false;
  if (lowerParts.some(part => part === 'environments')) return false;
  if (
    base === 'collection.bru' ||
    base === 'folder.bru' ||
    base === 'folder.yml' ||
    base === 'folder.yaml' ||
    base === 'opencollection.yml' ||
    base === 'opencollection.yaml'
  ) {
    return false;
  }
  return base.endsWith('.bru') || base.endsWith('.yml') || base.endsWith('.yaml');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function titleFromManifest(relativePath: string, content: string): string {
  try {
    const parsed =
      relativePath.toLowerCase() === 'bruno.json'
        ? (JSON.parse(content) as unknown)
        : parseYaml(content);
    if (!isRecord(parsed)) return '';
    if (typeof parsed.name === 'string') return parsed.name.trim();
    if (isRecord(parsed.info) && typeof parsed.info.name === 'string') {
      return parsed.info.name.trim();
    }
  } catch {
    return '';
  }
  return '';
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? '';
}

/**
 * Pick and read a Bruno collection through Lingua's capability-scoped FS
 * bridge. The root capability is temporary and revoked on every settled path.
 */
export async function loadBrunoDirectoryPreview(
  fs: BrunoDirectoryFs = window.lingua.fs
): Promise<BrunoDirectoryImportOutcome> {
  let selected: Awaited<ReturnType<BrunoDirectoryFs['selectDirectory']>>;
  try {
    selected = await fs.selectDirectory();
  } catch {
    return reject('directory-unreadable');
  }
  if (selected.canceled) return { status: 'cancelled' };

  let sourceBytes = 0;
  try {
    const indexed = await fs.listAllFiles(selected.rootId, '' as RelativePath);
    const marker = ['opencollection.yml', 'opencollection.yaml', 'bruno.json']
      .map(name =>
        indexed.find(file => file.relativePath.replaceAll('\\', '/').toLowerCase() === name)
      )
      .find(file => file !== undefined);
    if (!marker) return reject('directory-not-collection');

    const candidates = indexed
      .filter(file => isRequestCandidate(file.relativePath))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
    if (candidates.length > MAX_BRUNO_DIRECTORY_FILES) {
      return reject('directory-too-many-files');
    }

    const toRead = [marker, ...candidates];
    for (const file of toRead) {
      const stat = await fs.stat(selected.rootId, file.relativePath);
      if (!stat.isFile || stat.isDirectory) return reject('directory-unreadable', sourceBytes);
      sourceBytes += stat.size;
      if (sourceBytes > MAX_COLLECTION_BYTES) {
        return reject('directory-oversized', sourceBytes);
      }
    }

    const manifestContent = await fs.read(selected.rootId, marker.relativePath);
    const requestFiles: BrunoDirectoryFile[] = [];
    let actualBytes = utf8ByteLength(manifestContent);
    for (const file of candidates) {
      const content = await fs.read(selected.rootId, file.relativePath);
      actualBytes += utf8ByteLength(content);
      if (actualBytes > MAX_COLLECTION_BYTES) {
        return reject('directory-oversized', actualBytes);
      }
      requestFiles.push({ relativePath: file.relativePath, content });
    }

    const title =
      titleFromManifest(marker.relativePath, manifestContent) ||
      basename(selected.rootPath) ||
      'Bruno collection';
    const outcome = previewBrunoDirectory(title, requestFiles);
    if (!outcome.ok) {
      return reject(
        outcome.detail === 'directory-invalid-request'
          ? 'directory-invalid-request'
          : 'directory-empty',
        actualBytes
      );
    }
    return { status: 'previewed', preview: outcome.preview, sourceBytes: actualBytes };
  } catch {
    return reject('directory-unreadable', sourceBytes);
  } finally {
    await fs.revokeRoot(selected.rootId).catch(() => false);
  }
}
