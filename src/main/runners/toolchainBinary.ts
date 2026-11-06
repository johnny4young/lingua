/**
 * Where the Go and Rust binaries come from: the binary the user chose, then
 * PATH, then the install folders a Finder or desktop-file launch does not
 * inherit. The chosen path is picked through a native dialog in main and kept
 * in userData; the renderer never sends a path.
 */

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, type WebContents } from 'electron';
import type { ToolchainChooseResult } from '../../shared/toolchainBinary';
import { blockedPathFamily } from '../ipc/permissions';

export type ToolchainBinaryId = 'go' | 'rust';

const COMMANDS: Record<ToolchainBinaryId, string> = { go: 'go', rust: 'rustc' };

function toolchainExecutableName(id: ToolchainBinaryId, platform = process.platform): string {
  return platform === 'win32' ? `${COMMANDS[id]}.exe` : COMMANDS[id];
}

export function toolchainSearchDirs(
  id: ToolchainBinaryId,
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const brew = platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : ['/usr/local/bin'];
  if (id === 'go') {
    if (platform === 'win32') return [join(env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin'), join(home, 'go', 'bin')];
    return ['/usr/local/go/bin', join(home, 'go', 'bin'), ...brew, ...(platform === 'linux' ? ['/snap/bin'] : [])];
  }
  const cargoBin = join(env.CARGO_HOME || join(home, '.cargo'), 'bin');
  return platform === 'win32' ? [cargoBin] : [cargoBin, ...brew];
}

/** Home-relative so the empty state never prints the account name. */
export function displayToolchainPath(value: string, home = os.homedir(), platform = process.platform): string {
  if (!home) return value;
  const fold = (text: string) => (platform === 'win32' ? text.toLowerCase() : text);
  const sep = platform === 'win32' ? path.win32.sep : path.posix.sep;
  if (fold(value) === fold(home)) return '~';
  return fold(value).startsWith(fold(home + sep)) ? `~${value.slice(home.length)}` : value;
}

/** A spawn error names the binary's absolute path; the renderer gets the errno only. */
export function toolchainSpawnFailure(label: string, error: Error): string {
  return `${label} could not start (${(error as NodeJS.ErrnoException).code ?? 'error'}).`;
}

export function toolchainSearchedPlaces(id: ToolchainBinaryId): string[] {
  return toolchainSearchDirs(id).map((dir) => displayToolchainPath(dir));
}

/** POSIX only: refuse a file other local accounts could have planted or swapped. */
async function isOwnedSafely(candidate: string): Promise<boolean> {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return true;
  const uid = process.getuid();
  try {
    const [file, dir] = await Promise.all([stat(candidate), stat(path.dirname(candidate))]);
    const owned = file.uid === uid || file.uid === 0;
    return owned && (file.mode & 0o002) === 0 && (dir.mode & 0o002) === 0;
  } catch {
    return false;
  }
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    if (process.platform !== 'win32') await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A spawned toolchain finds its sibling tools (rustup proxies, cgo helpers). */
export function withBinaryDirOnPath(env: NodeJS.ProcessEnv, binary: string): NodeJS.ProcessEnv {
  if (!path.isAbsolute(binary)) return env;
  const dir = path.dirname(binary);
  const parts = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return parts.includes(dir) ? env : { ...env, PATH: [dir, ...parts].join(path.delimiter) };
}

export type ToolchainProbe<T> =
  | { kind: 'found'; value: T }
  | { kind: 'missing' }
  | { kind: 'failed'; timedOut?: boolean };

export type ToolchainSearch<T> =
  | { kind: 'found'; value: T; command: string }
  | { kind: 'missing' }
  | { kind: 'failed'; timedOut?: boolean };

/** The chosen binary, the bare command on PATH, then existing fallback files. */
export async function toolchainCandidates(id: ToolchainBinaryId): Promise<string[]> {
  const stored = await chosenToolchainBinaries.get(id);
  // The file can change after it was picked; it must still pass the same static checks.
  const chosen = stored && (await passesStaticChecks(id, stored)) === null ? stored : undefined;
  const fallbacks = toolchainSearchDirs(id).map((dir) => path.join(dir, toolchainExecutableName(id)));
  const usable = await Promise.all(fallbacks.map(isExecutableFile));
  return [...new Set([...(chosen ? [chosen] : []), COMMANDS[id], ...fallbacks.filter((_, index) => usable[index])])];
}

/**
 * First candidate that answers wins; missing only when none of them exists. A
 * timeout ends the search: the next candidate is often the same binary.
 */
export async function findToolchain<T>(
  candidates: readonly string[],
  probe: (command: string) => Promise<ToolchainProbe<T>>,
  signal?: AbortSignal
): Promise<ToolchainSearch<T>> {
  let failure: { kind: 'failed'; timedOut?: boolean } | null = null;
  for (const command of candidates) {
    if (signal?.aborted) return { kind: 'failed' };
    const result = await probe(command);
    if (result.kind === 'found') return { kind: 'found', value: result.value, command };
    if (result.kind === 'failed') {
      if (result.timedOut) return result;
      failure ??= result;
    }
  }
  return failure ?? { kind: 'missing' };
}

function createChosenToolchainStore() {
  let filePath: string | null = null;
  let cache: Partial<Record<ToolchainBinaryId, string>> | null = null;

  async function load(): Promise<Partial<Record<ToolchainBinaryId, string>>> {
    if (cache) return cache;
    if (!filePath) return {};
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
      cache = {};
      for (const id of ['go', 'rust'] as const) {
        const value = raw[id];
        if (typeof value === 'string' && path.isAbsolute(value)) cache[id] = value;
      }
    } catch {
      cache = {};
    }
    return cache;
  }

  return {
    configure(userDataDir: string) {
      filePath = path.join(userDataDir, 'toolchain-binaries.json');
      cache = null;
    },
    async get(id: ToolchainBinaryId): Promise<string | undefined> {
      return (await load())[id];
    },
    async set(id: ToolchainBinaryId, binary: string): Promise<void> {
      if (!filePath) throw new Error('Toolchain binary store is not configured.');
      const next = { ...(await load()), [id]: binary };
      const tmp = `${filePath}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(tmp, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`, { mode: 0o600 });
      if (process.platform !== 'win32') await chmod(tmp, 0o600);
      try {
        await rename(tmp, filePath);
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
      cache = next;
    },
  };
}

export const chosenToolchainBinaries = createChosenToolchainStore();

export function configureToolchainBinaryStore(userDataDir: string): void {
  chosenToolchainBinaries.configure(userDataDir);
}

/**
 * Check a picked file before it is ever kept: an executable regular file named
 * like the toolchain, outside credential and app-data folders and owned so no
 * other account can swap it, that answers its version probe (`verify` returns
 * the version, or null).
 */
type InvalidReason = Extract<ToolchainChooseResult, { status: 'invalid' }>['reason'];

async function passesStaticChecks(id: ToolchainBinaryId, chosen: string): Promise<InvalidReason | null> {
  if (!path.isAbsolute(chosen) || !(await isExecutableFile(chosen))) return 'not-executable';
  if (path.basename(chosen).toLowerCase() !== toolchainExecutableName(id)) return 'wrong-name';
  // Toolchains legitimately live under /usr and Program Files; credential and app-data folders do not.
  const blocked = blockedPathFamily(chosen);
  if ((blocked !== null && blocked !== 'system') || !(await isOwnedSafely(chosen))) return 'blocked';
  return null;
}

export async function validateToolchainBinary(
  id: ToolchainBinaryId,
  chosen: string,
  verify: (binary: string) => Promise<string | null>
): Promise<ToolchainChooseResult> {
  const reason = await passesStaticChecks(id, chosen);
  if (reason) return { status: 'invalid', reason };
  const version = await verify(chosen);
  return version ? { status: 'saved', version } : { status: 'invalid', reason: 'check-failed' };
}

export async function chooseToolchainBinary(
  id: ToolchainBinaryId,
  sender: WebContents,
  verify: (binary: string) => Promise<string | null>
): Promise<ToolchainChooseResult> {
  const window = BrowserWindow.fromWebContents(sender);
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'showHiddenFiles'],
    defaultPath: (await chosenToolchainBinaries.get(id)) ?? os.homedir(),
  };
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  const chosen = picked.filePaths[0];
  if (picked.canceled || !chosen) return { status: 'canceled' };
  const result = await validateToolchainBinary(id, chosen, verify);
  if (result.status !== 'saved') return result;
  try {
    await chosenToolchainBinaries.set(id, chosen);
  } catch {
    // The error names the userData path; the renderer only needs to know it failed.
    return { status: 'invalid', reason: 'save-failed' };
  }
  return result;
}
