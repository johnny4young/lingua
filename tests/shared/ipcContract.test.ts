/**
 * Drift guard for the typed IPC contract (`src/shared/ipcContract.ts`).
 *
 * The contract only eliminates preload↔main drift if it stays in lockstep
 * with the handlers actually registered in main. This test scans the
 * main-process source for every `ipcMain.handle(...)` / `typedHandle(...)`
 * literal channel and asserts:
 *   1. every registered channel is a contract key (no orphan handler), and
 *   2. every contract channel is registered somewhere (no dead contract
 *      entry), accounting for the LSP handlers that register under
 *      dynamically-built channel names.
 * It also pins `IPC_INVOKE_CHANNELS` (the runtime list) to the contract
 * type surface.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IPC_INVOKE_CHANNELS,
  type IpcInvokeChannel,
} from '../../src/shared/ipcContract';

const MAIN_DIR = resolve(__dirname, '../../src/main');

/**
 * Channels registered under a computed name (the generic LSP registrar
 * builds `lsp:${language}:${suffix}`), so a static literal scan cannot see
 * them. Enumerated here explicitly; the contract still types them and this
 * test still requires them to BE in the contract.
 */
const DYNAMICALLY_REGISTERED: readonly IpcInvokeChannel[] = [
  'lsp:rust:start',
  'lsp:rust:restart',
  'lsp:rust:stop',
  'lsp:rust:status',
  'lsp:rust:request',
  'lsp:go:start',
  'lsp:go:restart',
  'lsp:go:stop',
  'lsp:go:status',
  'lsp:go:request',
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function collectRegisteredChannels(): Set<string> {
  const channels = new Set<string>();
  // `\s*` spans newlines (the channel literal is often on the line after
  // `handle(`); the helper's own definition file is skipped so its generic
  // signature is not mistaken for a registration.
  const pattern =
    /(?:ipcMain\.handle|typedHandle)\(\s*['"]([^'"]+)['"]/g;
  for (const file of walkTsFiles(MAIN_DIR)) {
    if (file.endsWith(join('ipc', 'typedHandle.ts'))) continue;
    const text = readFileSync(file, 'utf-8');
    for (const match of text.matchAll(pattern)) {
      channels.add(match[1]!);
    }
  }
  return channels;
}

describe('IPC contract ↔ handler parity', () => {
  it('IPC_INVOKE_CHANNELS has no duplicates', () => {
    expect(new Set(IPC_INVOKE_CHANNELS).size).toBe(IPC_INVOKE_CHANNELS.length);
  });

  it('every statically-registered handler channel is in the contract', () => {
    const contract = new Set<string>(IPC_INVOKE_CHANNELS);
    const registered = collectRegisteredChannels();
    const orphans = [...registered].filter((c) => !contract.has(c));
    expect(orphans, `handlers registered for channels missing from IpcInvokeContract: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every contract channel is registered by a handler', () => {
    const registered = collectRegisteredChannels();
    for (const dynamic of DYNAMICALLY_REGISTERED) registered.add(dynamic);
    const missing = IPC_INVOKE_CHANNELS.filter((c) => !registered.has(c));
    expect(missing, `contract channels with no registered handler: ${missing.join(', ')}`).toEqual([]);
  });

  it('dynamically-registered LSP channels are declared in the contract', () => {
    const contract = new Set<string>(IPC_INVOKE_CHANNELS);
    const missing = DYNAMICALLY_REGISTERED.filter((c) => !contract.has(c));
    expect(missing).toEqual([]);
  });
});
