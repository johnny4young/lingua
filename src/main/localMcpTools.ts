import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { LocalMcpToolName } from '../shared/localMcp';
import { resolveCapabilityPath } from './ipc/projectCapabilities';
import { searchProjectText } from './ipc/fs/projectTextSearch';
import { shouldHide } from './ipc/fs/fsShared';

const MAX_RELATIVE_PATH_CHARS = 4_096;
const MAX_READ_BYTES = 512 * 1024;
const DEFAULT_READ_BYTES = 128 * 1024;
const MAX_READ_OFFSET = 128 * 1024 * 1024;
const MAX_TREE_DEPTH = 6;
const MAX_TREE_ENTRIES = 500;
const MAX_SEARCH_QUERY_CHARS = 256;
const MAX_SEARCH_RESULTS = 250;

const SECRET_DIRECTORIES = new Set(['.aws', '.gnupg', '.ssh']);
const SECRET_FILE_NAMES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  '_netrc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'service-account.json',
  'service_account.json',
]);
const SECRET_EXTENSIONS = new Set(['.jks', '.key', '.keystore', '.p12', '.pfx', '.pem']);

interface LocalMcpToolContext {
  readonly rootId: string;
  readonly projectName: string;
  readonly appVersion: string;
  readonly onToolCall: (name: LocalMcpToolName) => void;
}

interface ProjectTreeEntry {
  readonly path: string;
  readonly type: 'directory' | 'file';
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isLocalMcpSensitivePath(relativePath: string): boolean {
  const segments = normalizeRelativePath(relativePath)
    .split('/')
    .filter(Boolean)
    .map(segment => segment.toLowerCase());
  if (segments.some(segment => SECRET_DIRECTORIES.has(segment))) return true;
  const name = segments.at(-1) ?? '';
  if (SECRET_FILE_NAMES.has(name)) return true;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (name === 'secrets' || name.startsWith('secrets.')) return true;
  return SECRET_EXTENSIONS.has(path.extname(name));
}

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

async function resolveReadablePath(rootId: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  if (relativePath.length > MAX_RELATIVE_PATH_CHARS) {
    throw new Error('path-too-long');
  }
  if (isLocalMcpSensitivePath(normalized)) {
    throw new Error('sensitive-path');
  }
  const resolution = await resolveCapabilityPath(rootId, normalized, 'read');
  if (!resolution.ok) throw new Error('path-not-authorized');
  // The approved root may itself be a symlink. Compare both canonical paths,
  // not the display root against the resolved target (which hides aliases).
  const root = await resolveCapabilityPath(rootId, '', 'read');
  if (!root.ok) throw new Error('path-not-authorized');
  const canonicalRelative = path.relative(root.absolutePath, resolution.absolutePath);
  if (isLocalMcpSensitivePath(canonicalRelative)) throw new Error('sensitive-path');
  return { ...resolution, normalized };
}

async function collectTree(
  rootId: string,
  absoluteRoot: string,
  relativeRoot: string,
  depth: number,
  maxEntries: number
): Promise<{ entries: ProjectTreeEntry[]; truncated: boolean }> {
  const entries: ProjectTreeEntry[] = [];
  let truncated = false;

  async function walk(absoluteDirectory: string, relativeDirectory: string, level: number) {
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    let children;
    try {
      children = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (shouldHide(child.name)) continue;
      const relativePath = [relativeDirectory, child.name].filter(Boolean).join('/');
      if (isLocalMcpSensitivePath(relativePath)) continue;
      // Preserve omission of symlink entries, and recheck actual destinations
      // for regular entries before exposing or descending into them.
      if (!child.isDirectory() && !child.isFile()) continue;
      let readable;
      try {
        readable = await resolveReadablePath(rootId, relativePath);
      } catch {
        continue;
      }
      if (child.isDirectory()) {
        entries.push({ path: relativePath, type: 'directory' });
        if (level < depth) {
          await walk(readable.absolutePath, relativePath, level + 1);
        }
      } else if (child.isFile()) {
        entries.push({ path: relativePath, type: 'file' });
      }
    }
  }

  await walk(absoluteRoot, relativeRoot, 1);
  return { entries, truncated };
}

export function registerLocalMcpTools(server: McpServer, context: LocalMcpToolContext): void {
  const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  server.registerTool(
    'lingua_project_info',
    {
      title: 'Lingua project information',
      description:
        'Describe the project approved in Lingua and the exact read-only MCP capability surface. Does not reveal the host path or authorization token.',
      annotations: readOnlyAnnotations,
    },
    async () => {
      context.onToolCall('lingua_project_info');
      const root = await resolveCapabilityPath(context.rootId, '', 'read');
      if (!root.ok) return errorResult('The approved Lingua project is no longer available.');
      return textResult({
        projectName: context.projectName,
        server: { name: 'Lingua', version: context.appVersion },
        access: 'read-only',
        capabilities: ['project-info', 'list-files', 'read-text-file', 'literal-search'],
        exclusions: ['writes', 'execution', 'network', 'known-secret-files', 'binary-files'],
      });
    }
  );

  server.registerTool(
    'lingua_list_files',
    {
      title: 'List Lingua project files',
      description:
        'List visible regular files and directories below a relative project path. Vendor, build, hidden, symlink, and known secret-bearing entries are omitted.',
      inputSchema: z.object({
        path: z.string().max(MAX_RELATIVE_PATH_CHARS).default(''),
        depth: z.number().int().min(1).max(MAX_TREE_DEPTH).default(2),
        maxEntries: z.number().int().min(1).max(MAX_TREE_ENTRIES).default(200),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ path: relativePath, depth, maxEntries }) => {
      context.onToolCall('lingua_list_files');
      try {
        const resolved = await resolveReadablePath(context.rootId, relativePath);
        const info = await stat(resolved.absolutePath);
        if (!info.isDirectory())
          return errorResult('The requested project path is not a directory.');
        const result = await collectTree(
          context.rootId,
          resolved.absolutePath,
          resolved.normalized,
          depth,
          maxEntries
        );
        return textResult({
          basePath: resolved.normalized || '.',
          entries: result.entries,
          truncated: result.truncated,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'sensitive-path') {
          return errorResult('The requested path is excluded by Lingua’s secret-file policy.');
        }
        return errorResult('The requested project path is unavailable or not authorized.');
      }
    }
  );

  server.registerTool(
    'lingua_read_file',
    {
      title: 'Read a Lingua project file',
      description:
        'Read a byte-bounded UTF-8 slice. Offset and nextOffset are byte positions at code-point boundaries; maxBytes must fit at least one code point. Binary and known secret-bearing paths and symlink targets are refused.',
      inputSchema: z.object({
        path: z.string().min(1).max(MAX_RELATIVE_PATH_CHARS),
        offset: z.number().int().min(0).max(MAX_READ_OFFSET).default(0),
        maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).default(DEFAULT_READ_BYTES),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ path: relativePath, offset, maxBytes }) => {
      context.onToolCall('lingua_read_file');
      let handle;
      try {
        const resolved = await resolveReadablePath(context.rootId, relativePath);
        const info = await stat(resolved.absolutePath);
        if (!info.isFile()) return errorResult('The requested project path is not a file.');
        if (offset > info.size)
          return errorResult('The requested offset is beyond the end of the file.');

        handle = await open(resolved.absolutePath, 'r');
        const requestedBytes = Math.min(maxBytes, Math.max(0, info.size - offset));
        const buffer = Buffer.alloc(requestedBytes);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytes.includes(0)) return errorResult('Lingua refused to expose a binary file.');

        let content: string;
        try {
          // Streaming mode retains only a trailing incomplete code point when
          // more file bytes remain. At EOF, incomplete UTF-8 must still fail.
          content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            bytes,
            { stream: offset + bytesRead < info.size }
          );
        } catch {
          return errorResult('The file is not valid UTF-8 at the requested byte offset. Start at a code-point boundary.');
        }
        const contentBytes = Buffer.byteLength(content, 'utf8');
        if (bytesRead > 0 && contentBytes === 0) {
          return errorResult('The byte budget cannot fit the next UTF-8 code point. Request at least 4 bytes.');
        }
        const nextOffset = offset + contentBytes;
        return textResult({
          path: resolved.normalized,
          content,
          offset,
          bytesRead: contentBytes,
          truncated: nextOffset < info.size,
          nextOffset: nextOffset < info.size ? nextOffset : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'sensitive-path') {
          return errorResult('The requested path is excluded by Lingua’s secret-file policy.');
        }
        return errorResult('The requested project file is unavailable or not authorized.');
      } finally {
        await handle?.close().catch(() => undefined);
      }
    }
  );

  server.registerTool(
    'lingua_search_project',
    {
      title: 'Search Lingua project text',
      description:
        'Search for a literal string in bounded UTF-8 project files. Results from known secret-bearing paths are omitted.',
      inputSchema: z.object({
        query: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS),
        path: z.string().max(MAX_RELATIVE_PATH_CHARS).default(''),
        caseSensitive: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(100),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ query, path: relativePath, caseSensitive, maxResults }) => {
      context.onToolCall('lingua_search_project');
      try {
        const resolved = await resolveReadablePath(context.rootId, relativePath);
        const info = await stat(resolved.absolutePath);
        if (!info.isDirectory())
          return errorResult('The requested project path is not a directory.');
        const results = await searchProjectText({
          searchRootAbsolutePath: resolved.absolutePath,
          rootRelativePath: resolved.normalized,
          query,
          caseSensitive,
          maxMatchesPerFile: 20,
          maxTotalMatches: Math.min(MAX_SEARCH_RESULTS * 2, maxResults * 2),
          maxFileSize: 512 * 1024,
          maxFilesScanned: 5_000,
        });
        const authorizedResults: typeof results = [];
        for (const result of results) {
          try {
            await resolveReadablePath(context.rootId, result.relativePath);
            authorizedResults.push(result);
          } catch {
            // A secret destination, revoked root or disappeared file must not
            // expose an already-collected match in the outgoing response.
          }
        }
        const safeResults = authorizedResults
          .flatMap(result =>
            result.matches.map(match => ({
              path: result.relativePath,
              line: match.line,
              column: match.column,
              preview: match.preview,
              matchStart: match.matchStart,
              matchEnd: match.matchEnd,
            }))
          )
          .slice(0, maxResults);
        return textResult({
          query,
          basePath: resolved.normalized || '.',
          matches: safeResults,
          truncated: safeResults.length === maxResults,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'sensitive-path') {
          return errorResult('The requested path is excluded by Lingua’s secret-file policy.');
        }
        return errorResult('The requested project path is unavailable or not authorized.');
      }
    }
  );
}
