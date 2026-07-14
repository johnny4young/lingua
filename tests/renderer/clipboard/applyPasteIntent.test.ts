import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRange } from 'monaco-editor';
import { applyPasteIntent, type ApplyPasteContext } from '@/clipboard/applyPasteIntent';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { subscribeCommand } from '@/stores/commandBus';

/**
 * RL-110 — locks the impure router's delegation: each intent kind routes to the
 * right existing importer and (for content imports) strips the literal paste.
 * Delegates + stores are mocked via their aliases; the real `parseRunCapsule` /
 * `parseCurlCommand` run on real fixtures so detection and routing agree.
 */
const spies = vi.hoisted(() => ({
  addTab: vi.fn(),
  createRequest: vi.fn(),
  setPendingCapsule: vi.fn(),
  openHttp: vi.fn(),
  decodeShareFragment: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ addTab: spies.addTab }) },
}));
vi.mock('@/stores/workspaceToolStore', () => ({
  useWorkspaceToolStore: { getState: () => ({ createRequest: spies.createRequest }) },
}));
vi.mock('@/clipboard/pendingCapsuleImport', () => ({
  setPendingCapsuleImportSource: spies.setPendingCapsule,
}));
vi.mock('@/runtime/openWorkspaceTab', () => ({ openHttpWorkspaceTab: spies.openHttp }));
vi.mock('@/stores/editorTabUtils', () => ({
  createDefaultTab: (language = 'javascript') => ({
    id: 't',
    name: 'x',
    language,
    content: '',
    isDirty: false,
  }),
}));
vi.mock('#src/shared/sharePayload', async importOriginal => {
  const actual = await importOriginal<typeof import('#src/shared/sharePayload')>();
  return { ...actual, decodeShareFragment: spies.decodeShareFragment };
});

function makeCtx(currentText = 'paste'): {
  ctx: ApplyPasteContext;
  pushEditOperations: ReturnType<typeof vi.fn>;
} {
  const pushEditOperations = vi.fn();
  const pastedRange: IRange = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 5,
  };
  return {
    ctx: {
      model: { getValueInRange: () => currentText, pushEditOperations },
      pastedRange,
      pastedText: 'paste',
    },
    pushEditOperations,
  };
}

beforeEach(() => {
  spies.decodeShareFragment.mockResolvedValue({
    ok: true,
    payload: {
      tab: { language: 'javascript', name: 'shared.js' },
      source: { content: 'shared()' },
      modes: {},
      input: {},
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('applyPasteIntent', () => {
  it('routes a share-link: decode + addTab + strips the paste', async () => {
    const { ctx, pushEditOperations } = makeCtx();
    const ok = await applyPasteIntent({ kind: 'share-link', fragment: 'share=v1.abc' }, ctx);
    expect(ok).toBe(true);
    expect(spies.decodeShareFragment).toHaveBeenCalledWith('share=v1.abc');
    expect(spies.addTab).toHaveBeenCalledWith(expect.objectContaining({ content: 'shared()' }));
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
  });

  it('leaves the paste in place when the share link fails to decode', async () => {
    spies.decodeShareFragment.mockResolvedValueOnce({ ok: false, reason: 'invalid-base64' });
    const { ctx, pushEditOperations } = makeCtx();
    const ok = await applyPasteIntent({ kind: 'share-link', fragment: 'share=v1.bad' }, ctx);
    expect(ok).toBe(false);
    expect(spies.addTab).not.toHaveBeenCalled();
    expect(pushEditOperations).not.toHaveBeenCalled();
  });

  it('routes a capsule: stashes the source + opens the confirm-first overlay + strips the paste', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('capsule.openImport', listener);
    const { ctx, pushEditOperations } = makeCtx();
    const source = JSON.stringify(FIXTURE_MINIMAL_JS);
    const ok = await applyPasteIntent({ kind: 'capsule', source }, ctx);
    expect(ok).toBe(true);
    expect(spies.setPendingCapsule).toHaveBeenCalledWith(source);
    expect(listener).toHaveBeenCalledOnce();
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('routes a cURL: createRequest with method/url + opens the HTTP workspace', async () => {
    const { ctx, pushEditOperations } = makeCtx();
    const ok = await applyPasteIntent(
      {
        kind: 'curl',
        source:
          "curl -X POST https://api.example.com/v1/users -H 'Content-Type: application/json' -d '{\"a\":1}'",
      },
      ctx
    );
    expect(ok).toBe(true);
    expect(spies.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', url: 'https://api.example.com/v1/users' })
    );
    expect(spies.openHttp).toHaveBeenCalledTimes(1);
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
  });

  it('does not strip the editor when the original pasted range changed before import', async () => {
    const { ctx, pushEditOperations } = makeCtx('user kept typing');
    const ok = await applyPasteIntent(
      {
        kind: 'curl',
        source:
          "curl -X POST https://api.example.com/v1/users -H 'Content-Type: application/json' -d '{\"a\":1}'",
      },
      ctx
    );
    expect(ok).toBe(true);
    expect(spies.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', url: 'https://api.example.com/v1/users' })
    );
    expect(pushEditOperations).not.toHaveBeenCalled();
  });

  it('routes a stack-trace via the file.open command and leaves the paste', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('file.open', listener);
    const { ctx, pushEditOperations } = makeCtx();
    const ok = await applyPasteIntent(
      { kind: 'stack-trace', file: '/app/handler.js', line: 42, column: 15 },
      ctx
    );
    expect(ok).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/app/handler.js', line: 42, column: 15 }),
      expect.any(Object)
    );
    expect(pushEditOperations).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('routes a large-json into a new json tab + strips the paste', async () => {
    const { ctx, pushEditOperations } = makeCtx();
    const ok = await applyPasteIntent({ kind: 'large-json', source: '{"rows":[]}' }, ctx);
    expect(ok).toBe(true);
    expect(spies.addTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'json', content: '{"rows":[]}' })
    );
    expect(pushEditOperations).toHaveBeenCalledTimes(1);
  });
});
