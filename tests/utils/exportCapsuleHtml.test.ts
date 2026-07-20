/**
 * internal — renderer orchestration for the capsule → HTML export.
 *
 * Mirrors `exportCapsule.trustCapture.test.ts`: the save layer is
 * mocked at the module seam (`saveTextFileToDisk`), Monaco is mocked
 * at its module path (the orchestrator imports it dynamically), and
 * the assertions pin the flow contract:
 *
 *   - the document handed to the save layer is the built HTML with
 *     the deterministic filename + MIME,
 *   - tokenization failure falls back to a plain (uncolored) export
 *     instead of blocking,
 *   - the trust event records ONLY after a successful save, never on
 *     error, and stays metadata-only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { exportCapsuleAsHtml } from '../../src/renderer/utils/exportCapsuleHtml';
import { saveOrDownloadTextFile } from '../../src/renderer/utils/saveTextFileToDisk';
import {
  _resetTrustEventCounterForTesting,
  useTrustEventStore,
} from '../../src/renderer/stores/trustEventStore';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

vi.mock('../../src/renderer/utils/saveTextFileToDisk', () => ({
  saveOrDownloadTextFile: vi.fn(),
}));

const tokenizeMock = vi.fn();

vi.mock('../../src/renderer/monaco', () => ({
  getConfiguredMonaco: () => ({
    editor: {
      createModel: () => ({ dispose: () => {} }),
      colorize: async () => '',
      tokenize: (code: string, languageId: string) =>
        tokenizeMock(code, languageId),
    },
  }),
  registerLanguageOnce: async () => {},
}));

const saveMock = vi.mocked(saveOrDownloadTextFile);
const t = ((key: string) => key) as TFunction;

function lastSaveCall() {
  const call = saveMock.mock.calls.at(-1);
  if (!call) throw new Error('saveOrDownloadTextFile was not called');
  return { html: call[0], filename: call[1], mime: call[2], handlers: call[3] };
}

beforeEach(() => {
  _resetTrustEventCounterForTesting();
  useTrustEventStore.getState().clear();
  saveMock.mockReset().mockResolvedValue(undefined);
  // Default: one keyword token covering each line.
  tokenizeMock.mockReset().mockImplementation((code: string) =>
    code
      .split(/\r\n|\r|\n/u)
      .map(() => [{ offset: 0, type: 'keyword.js', language: 'javascript' }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('exportCapsuleAsHtml', () => {
  it('hands the built document to the save layer with filename + MIME', async () => {
    const onOk = vi.fn();
    await exportCapsuleAsHtml(FIXTURE_MINIMAL_JS, 'settings-export-html', {
      t,
      locale: 'en',
      onOk,
      onError: vi.fn(),
    });
    const { html, filename, mime } = lastSaveCall();
    expect(filename).toBe('lingua-capsule-javascript-2026-05-21-00000000.html');
    expect(mime).toBe('text/html;charset=utf-8');
    expect(html).toContain('<meta name="lingua-capsule-schema" content="1">');
    // Monaco tokens colored the source.
    expect(html).toContain('<span style="color:#c678dd">');
  });

  it('falls back to a plain export when tokenization throws', async () => {
    tokenizeMock.mockImplementation(() => {
      throw new Error('no tokenizer');
    });
    await exportCapsuleAsHtml(FIXTURE_MINIMAL_JS, 'settings-export-html', {
      t,
      locale: 'en',
      onOk: vi.fn(),
      onError: vi.fn(),
    });
    const { html } = lastSaveCall();
    expect(html).toContain('const x = 1 + 2; console.log(x);');
    expect(html).not.toContain('<span style="color:');
  });

  it('records a metadata-only trust event ONLY after a successful save', async () => {
    saveMock.mockImplementation(async (_html, _name, _mime, handlers) => {
      handlers.onOk();
    });
    const onOk = vi.fn();
    await exportCapsuleAsHtml(FIXTURE_MINIMAL_JS, 'list-export-html', {
      t,
      locale: 'es',
      onOk,
      onError: vi.fn(),
    });
    expect(onOk).toHaveBeenCalledTimes(1);
    const events = useTrustEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feature: 'capsule-export',
      action: 'exported',
      sensitivity: 'medium',
    });
    expect(events[0]!.summary).toMatch(/^javascript capsule exported as HTML \(.+\)$/u);
    expect(events[0]!.summary).not.toContain(FIXTURE_MINIMAL_JS.source.content);
  });

  it('does NOT record a trust event when the save fails (nothing left the app)', async () => {
    saveMock.mockImplementation(async (_html, _name, _mime, handlers) => {
      handlers.onError();
    });
    const onError = vi.fn();
    await exportCapsuleAsHtml(FIXTURE_MINIMAL_JS, 'settings-export-html', {
      t,
      locale: 'en',
      onOk: vi.fn(),
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(useTrustEventStore.getState().events).toHaveLength(0);
  });
});
