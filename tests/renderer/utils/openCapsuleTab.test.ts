/**
 * RL-099 Slice 3 fold C — `openCapsuleSourceInNewTab` safe-language
 * fallback.
 *
 * A capsule whose `tab.language` is a workspace-kind marker (`'http'`
 * from RL-097, `'pipeline'` from RL-099) is NOT a real editor language
 * pack. The opener must not hand that token to the editor as a
 * language; it falls back to `createDefaultTab`'s default so the
 * recipe/text renders in a normal, runnable tab. A real pack language
 * (`'javascript'`) still round-trips unchanged.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { openCapsuleSourceInNewTab } from '../../../src/renderer/utils/openCapsuleTab';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { getLanguagePackById } from '../../../src/shared/languagePacks';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';

function makeCapsule(language: string, name = 'My capsule'): RunCapsuleV1 {
  return {
    version: 1,
    capsuleId: 'cap-1',
    createdAt: '2026-06-16T00:00:00.000Z',
    appVersion: '0.5.0',
    tab: { name, language, runtimeMode: 'utility-pipeline', workflowMode: 'run' },
    source: { content: '# Lingua utility pipeline capsule v1\n#1 json-format {}', contentHash: 'abc' },
    input: {
      stdin: 'some input',
      setName: 'Happy path',
      args: ['--mode', 'fast'],
    },
    result: { status: 'success', durationMs: 10 },
    environment: { platform: 'web', runner: 'utility-pipeline' },
    privacy: { redactionVersion: 'test', omittedFields: [] },
  };
}

describe('openCapsuleSourceInNewTab — non-code language fallback (RL-099 Slice 3 fold C)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('opens a pipeline capsule under a real editor language, never the raw marker', () => {
    openCapsuleSourceInNewTab(makeCapsule('pipeline'));
    const tab = useEditorStore.getState().tabs[0];
    expect(tab).toBeDefined();
    // The tab carries the recipe content + the capsule name…
    expect(tab?.content).toContain('# Lingua utility pipeline capsule v1');
    expect(tab?.name).toBe('My capsule');
    // …but its language is a REAL pack, never the 'pipeline' marker.
    expect(tab?.language).not.toBe('pipeline');
    expect(getLanguagePackById(tab!.language)).toBeDefined();
  });

  it('also fixes the latent http case — never opens an unrunnable "http" tab', () => {
    openCapsuleSourceInNewTab(makeCapsule('http', 'My request'));
    const tab = useEditorStore.getState().tabs[0];
    expect(tab).toBeDefined();
    expect(tab?.language).not.toBe('http');
    expect(getLanguagePackById(tab!.language)).toBeDefined();
    expect(tab?.name).toBe('My request');
  });

  it('round-trips a real pack language unchanged', () => {
    openCapsuleSourceInNewTab(makeCapsule('javascript', 'script.js'));
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.language).toBe('javascript');
    expect(tab?.name).toBe('script.js');
    expect(tab?.stdinBuffer).toBe('some input');
    expect(tab?.inputArgs).toEqual(['--mode', 'fast']);
    expect(tab?.inputSets).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        name: 'Happy path',
        stdin: 'some input',
        args: ['--mode', 'fast'],
      }),
    ]);
    expect(tab?.activeInputSetId).toBe(tab?.inputSets?.[0]?.id);
  });
});
