/** Runtime parsers for the filesystem IPC trust boundary. */

import type { IpcInvokeArgs, IpcInvokeChannel } from '../../../shared/ipcContract';
import {
  asRelativePath,
  asRootId,
  asWatchId,
  type RelativePath,
  type RootId,
} from '../../../shared/fs/brandedIds';
import { MAX_BUNDLE_ENTRY_BYTES } from '../../../shared/projectBundle';
import { coerceBundleBytes, isRecord } from './fsShared';

const MAX_ROOT_ID_BYTES = 256;
const MAX_WATCH_ID_BYTES = 256;
const MAX_PATH_BYTES = 32_768;
const MAX_FILE_NAME_BYTES = 1_024;
const MAX_LANGUAGE_BYTES = 64;
const MAX_QUERY_BYTES = 65_536;
const MAX_REPLACEMENT_BYTES = 1_000_000;
const MAX_LANGUAGE_HINT_BYTES = 128;

type FsInvokeChannel = Extract<IpcInvokeChannel, `fs:${string}`>;

class InvalidIpcArgumentsError extends TypeError {
  readonly code = 'ERR_INVALID_IPC_ARGUMENTS';

  constructor(channel: FsInvokeChannel, field: string) {
    super(`Invalid IPC arguments for ${channel}: ${field}`);
    this.name = 'InvalidIpcArgumentsError';
  }
}

function invalid(channel: FsInvokeChannel, field: string): never {
  throw new InvalidIpcArgumentsError(channel, field);
}

function assertCount(
  channel: FsInvokeChannel,
  args: readonly unknown[],
  minimum: number,
  maximum = minimum
): void {
  if (args.length < minimum || args.length > maximum) invalid(channel, 'arity');
}

function boundedString(
  channel: FsInvokeChannel,
  field: string,
  value: unknown,
  maximumBytes: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string') invalid(channel, field);
  if (!allowEmpty && value.length === 0) invalid(channel, field);
  if (Buffer.byteLength(value, 'utf8') > maximumBytes) invalid(channel, field);
  return value;
}

function optionalBoundedString(
  channel: FsInvokeChannel,
  field: string,
  value: unknown,
  maximumBytes: number,
  allowEmpty = false
): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(channel, field, value, maximumBytes, allowEmpty);
}

function optionalBoolean(
  channel: FsInvokeChannel,
  field: string,
  value: unknown
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(channel, field);
  return value;
}

function rootId(channel: FsInvokeChannel, value: unknown): RootId {
  return asRootId(boundedString(channel, 'rootId', value, MAX_ROOT_ID_BYTES));
}

function relativePath(channel: FsInvokeChannel, value: unknown): RelativePath {
  return asRelativePath(boundedString(channel, 'relativePath', value, MAX_PATH_BYTES, true));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function noUnknownKeys(
  channel: FsInvokeChannel,
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): void {
  if (Object.keys(value).some(key => !allowed.has(key))) invalid(channel, 'options');
}

const SEARCH_OPTION_KEYS = new Set([
  'caseSensitive',
  'maxMatchesPerFile',
  'maxTotalMatches',
  'maxFileSize',
  'maxFilesScanned',
]);
const REPLACE_OPTION_KEYS = new Set([...SEARCH_OPTION_KEYS, 'regex', 'perLineTimeoutMs']);
const BUNDLE_OPTION_KEYS = new Set(['entryFile', 'languageHint']);

function positiveNumberOption(
  channel: FsInvokeChannel,
  options: Record<string, unknown>,
  key: string
): number | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    invalid(channel, `options.${key}`);
  }
  return value;
}

function booleanOption(
  channel: FsInvokeChannel,
  options: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(channel, `options.${key}`);
  return value;
}

function searchOptions(channel: 'fs:searchInFiles', value: unknown): FsSearchOptions | undefined;
function searchOptions(
  channel: 'fs:replaceInFiles' | 'fs:applyReplaceInFile',
  value: unknown
): FsReplaceOptions | undefined;
function searchOptions(
  channel: 'fs:searchInFiles' | 'fs:replaceInFiles' | 'fs:applyReplaceInFile',
  value: unknown
): FsSearchOptions | FsReplaceOptions | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) invalid(channel, 'options');
  const replace = channel !== 'fs:searchInFiles';
  noUnknownKeys(channel, value, replace ? REPLACE_OPTION_KEYS : SEARCH_OPTION_KEYS);
  const parsed: FsReplaceOptions = {};
  const caseSensitive = booleanOption(channel, value, 'caseSensitive');
  if (caseSensitive !== undefined) parsed.caseSensitive = caseSensitive;
  for (const key of [
    'maxMatchesPerFile',
    'maxTotalMatches',
    'maxFileSize',
    'maxFilesScanned',
  ] as const) {
    const option = positiveNumberOption(channel, value, key);
    if (option !== undefined) parsed[key] = option;
  }
  if (replace) {
    const regex = booleanOption(channel, value, 'regex');
    if (regex !== undefined) parsed.regex = regex;
    const perLineTimeoutMs = positiveNumberOption(channel, value, 'perLineTimeoutMs');
    if (perLineTimeoutMs !== undefined) parsed.perLineTimeoutMs = perLineTimeoutMs;
  }
  return parsed;
}

export const fsArgs = {
  noArgs<C extends 'fs:select-directory' | 'fs:select-file'>(
    channel: C,
    args: readonly unknown[]
  ): IpcInvokeArgs<C> {
    assertCount(channel, args, 0);
    return [] as IpcInvokeArgs<C>;
  },

  saveDialog(args: readonly unknown[]): IpcInvokeArgs<'fs:save-dialog'> {
    const channel = 'fs:save-dialog';
    assertCount(channel, args, 1, 2);
    return [
      boundedString(channel, 'defaultName', args[0], MAX_FILE_NAME_BYTES, true),
      optionalBoundedString(channel, 'defaultDir', args[1], MAX_PATH_BYTES),
    ];
  },

  absolutePath<C extends 'fs:reopen-root' | 'fs:reopen-file' | 'fs:classify-blocked-path'>(
    channel: C,
    args: readonly unknown[]
  ): IpcInvokeArgs<C> {
    assertCount(channel, args, 1);
    return [boundedString(channel, 'absolutePath', args[0], MAX_PATH_BYTES)] as IpcInvokeArgs<C>;
  },

  rootOnly<C extends 'fs:revoke-root' | 'fs:exportBundle'>(
    channel: C,
    args: readonly unknown[]
  ): IpcInvokeArgs<C> {
    const maximum = channel === 'fs:exportBundle' ? 2 : 1;
    assertCount(channel, args, 1, maximum);
    if (channel === 'fs:revoke-root') return [rootId(channel, args[0])] as IpcInvokeArgs<C>;
    const rawOptions = args[1];
    if (rawOptions === undefined) return [rootId(channel, args[0])] as IpcInvokeArgs<C>;
    if (!isPlainRecord(rawOptions)) invalid(channel, 'options');
    noUnknownKeys(channel, rawOptions, BUNDLE_OPTION_KEYS);
    const options: { entryFile?: string; languageHint?: string } = {};
    const entryFile = optionalBoundedString(
      channel,
      'options.entryFile',
      rawOptions.entryFile,
      MAX_PATH_BYTES,
      true
    );
    const languageHint = optionalBoundedString(
      channel,
      'options.languageHint',
      rawOptions.languageHint,
      MAX_LANGUAGE_HINT_BYTES,
      true
    );
    if (entryFile !== undefined) options.entryFile = entryFile;
    if (languageHint !== undefined) options.languageHint = languageHint;
    return [rootId(channel, args[0]), options] as IpcInvokeArgs<C>;
  },

  rootRelative<
    C extends
      | 'fs:readdir'
      | 'fs:listAllFiles'
      | 'fs:stat'
      | 'fs:read'
      | 'fs:read-bytes'
      | 'fs:mkdir'
      | 'fs:touch'
      | 'fs:reveal-in-finder'
      | 'fs:watch-start',
  >(channel: C, args: readonly unknown[]): IpcInvokeArgs<C> {
    const optionalPath = channel === 'fs:listAllFiles' || channel === 'fs:watch-start';
    assertCount(channel, args, optionalPath ? 1 : 2, 2);
    const parsedRoot = rootId(channel, args[0]);
    if (args[1] === undefined && optionalPath) return [parsedRoot] as IpcInvokeArgs<C>;
    return [parsedRoot, relativePath(channel, args[1])] as IpcInvokeArgs<C>;
  },

  write(args: readonly unknown[]): IpcInvokeArgs<'fs:write'> {
    const channel = 'fs:write';
    assertCount(channel, args, 3);
    return [
      rootId(channel, args[0]),
      relativePath(channel, args[1]),
      boundedString(channel, 'content', args[2], MAX_BUNDLE_ENTRY_BYTES, true),
    ];
  },

  delete(args: readonly unknown[]): IpcInvokeArgs<'fs:delete'> {
    const channel = 'fs:delete';
    assertCount(channel, args, 2, 4);
    return [
      rootId(channel, args[0]),
      relativePath(channel, args[1]),
      optionalBoolean(channel, 'isDirectory', args[2]),
      optionalBoundedString(channel, 'language', args[3], MAX_LANGUAGE_BYTES, true),
    ];
  },

  rename(args: readonly unknown[]): IpcInvokeArgs<'fs:rename'> {
    const channel = 'fs:rename';
    assertCount(channel, args, 3);
    return [
      rootId(channel, args[0]),
      relativePath(channel, args[1]),
      boundedString(channel, 'newName', args[2], MAX_FILE_NAME_BYTES),
    ];
  },

  search(args: readonly unknown[]): IpcInvokeArgs<'fs:searchInFiles'> {
    const channel = 'fs:searchInFiles';
    assertCount(channel, args, 3, 4);
    return [
      rootId(channel, args[0]),
      relativePath(channel, args[1]),
      boundedString(channel, 'query', args[2], MAX_QUERY_BYTES, true),
      searchOptions(channel, args[3]),
    ];
  },

  replace<C extends 'fs:replaceInFiles' | 'fs:applyReplaceInFile'>(
    channel: C,
    args: readonly unknown[]
  ): IpcInvokeArgs<C> {
    assertCount(channel, args, 4, 5);
    return [
      rootId(channel, args[0]),
      relativePath(channel, args[1]),
      boundedString(channel, 'query', args[2], MAX_QUERY_BYTES, true),
      boundedString(channel, 'replacement', args[3], MAX_REPLACEMENT_BYTES, true),
      searchOptions(channel, args[4]),
    ] as IpcInvokeArgs<C>;
  },

  importBundle(args: readonly unknown[]): IpcInvokeArgs<'fs:importBundle'> {
    const channel = 'fs:importBundle';
    assertCount(channel, args, 1);
    const bytes = coerceBundleBytes(args[0]);
    if (!bytes) invalid(channel, 'zipBytes');
    return [bytes];
  },

  watchStop(args: readonly unknown[]): IpcInvokeArgs<'fs:watch-stop'> {
    const channel = 'fs:watch-stop';
    assertCount(channel, args, 1);
    return [asWatchId(boundedString(channel, 'watchId', args[0], MAX_WATCH_ID_BYTES))];
  },
};
