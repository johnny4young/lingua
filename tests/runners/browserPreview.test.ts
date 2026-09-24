import { getSandboxDocument } from '../../src/renderer/runtime/sandboxDocument';
/**
 * implementation — BrowserPreviewRunner + iframe bridge tests.
 *
 * Coverage:
 *
 *   - Runner metadata (id / name / language / extensions).
 *   - `init()` flips `isReady()` to true; `stop()` is a safe no-op
 *     when no run is in flight.
 *   - The bridge script template owns the right pieces (the
 *     discriminator + the serializer + console / error /
 *     unhandledrejection / done forwarders).
 *   - `buildPreviewDocument` injects user code verbatim (with
 *     literal close-script-tag sequences escaped), splices implementation note
 *     sibling sources, and carries the strict CSP meta tag.
 *   - `isBridgeMessage` accepts well-formed payloads and rejects
 *     spoofed shapes.
 *   - `execute()` rejects messages whose `origin` is not in the
 *     accept-set (`null` or our app origin) and messages whose
 *     `runId` does not match the active run.
 *   - `execute()` resolves on a `done` message, captures console
 *     entries inline, and seeds the rendered srcdoc with the sibling
 *     css / html tabs of the tab named by `context.tabId`.
 *   - Timeout: parent clears the iframe `srcdoc` and resolves with
 *     `runnerTimeoutResult`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BRIDGE_DISCRIMINATOR,
  IFRAME_CONTENT_SECURITY_POLICY,
  buildBridgeScript,
  buildDoneScript,
  buildPreviewDocument,
  isBridgeMessage,
} from '@/components/BrowserPreview/iframeBridge';
import { BrowserPreviewRunner } from '@/runners/browserPreview';
import {
  setActiveBrowserPreviewIframe,
  _resetBrowserPreviewBridgeForTesting,
} from '@/runtime/browserPreviewBridge';
import { collectBrowserPreviewSiblingSources } from '@/runtime/browserPreviewSiblings';
import { useEditorStore } from '@/stores/editorStore';
import type { FileTab } from '@/types';

describe('BrowserPreviewRunner — metadata', () => {
  it('reports id / name / language / extensions', () => {
    const runner = new BrowserPreviewRunner();
    expect(runner.id).toBe('browser-preview');
    expect(runner.name).toBe('Browser preview');
    expect(runner.language).toBe('javascript');
    expect(runner.extensions).toEqual(['.js', '.mjs', '.ts']);
  });

  it('init() flips isReady', async () => {
    const runner = new BrowserPreviewRunner();
    expect(runner.isReady()).toBe(false);
    await runner.init();
    expect(runner.isReady()).toBe(true);
  });

  it('stop() is a no-op when no run is in flight', () => {
    const runner = new BrowserPreviewRunner();
    expect(() => runner.stop()).not.toThrow();
  });
});

describe('iframe bridge — buildBridgeScript', () => {
  it('embeds the runId as a JSON string literal so an injected quote cannot break out', () => {
    const trickyRunId = 'abc"; alert(1); var x="';
    const script = buildBridgeScript(trickyRunId);
    // The JSON-stringified runId carries the original text inside
    // escaped quotes — `alert(1)` appears as part of the literal,
    // never as standalone JS.
    expect(script).toContain(JSON.stringify(trickyRunId));
    // Anti-spoof: the assignment site uses the JSON-escaped literal
    // so the opening `"` of the user-supplied id is contained.
    // The literal text `alert(1)` is part of the safe JSON
    // contents; the structural guard is that the runId assignment
    // line cannot end early.
    expect(script).toMatch(/var RUN_ID = "[^\n]*";/u);
    // Same line carries the escaped opening quote — the raw
    // unescaped form `abc"; alert` does NOT appear anywhere.
    expect(script).not.toContain('abc"; alert');
  });

  it('installs console / error / unhandledrejection forwarders', () => {
    const script = buildBridgeScript('abc');
    expect(script).toContain('console[method]');
    expect(script).toContain("window.addEventListener('error'");
    expect(script).toContain("window.addEventListener('unhandledrejection'");
    expect(script).toContain(`__lingua: '${BRIDGE_DISCRIMINATOR}'`);
    // Captured console output should stay inside Lingua's console
    // model; forwarding to the iframe's original console would
    // pollute the app-level console-error gate for user code.
    expect(script).not.toContain('original.apply');
    expect(script).toContain('event.preventDefault()');
  });

  it('posts a ready signal at the end of the IIFE', () => {
    const script = buildBridgeScript('abc');
    expect(script).toContain("post({ type: 'ready' })");
  });
});

describe('iframe bridge — buildDoneScript', () => {
  it('posts a provisional done signal after synchronous script evaluation', () => {
    const script = buildDoneScript('abc');
    expect(script).toContain('Promise.resolve().then');
    expect(script).toContain("type: 'done'");
  });
});

describe('iframe bridge — buildPreviewDocument', () => {
  it('carries the strict CSP meta tag', () => {
    const doc = buildPreviewDocument({
      runId: 'run-1',
      userCode: 'console.log(1);',
    });
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain(IFRAME_CONTENT_SECURITY_POLICY);
  });

  it('escapes a literal script close sequence inside user code so the tag does not break out', () => {
    // Build the close-script sequence from parts so this test file
    // itself does not embed a raw close tag (which would confuse
    // editor tooling that scans `.ts` for HTML-like patterns).
    const closeScript = ['<', '/', 'script', '>'].join('');
    const userCode = `const html = '${closeScript}';`;
    const doc = buildPreviewDocument({ runId: 'run-1', userCode });
    // The escaped variant proves the substitution ran.
    expect(doc).toContain('<\\/script>');
    // The user-script wrapper opening + closing tags still
    // balance (so the script payload is wrapped), and the
    // literal close from user code did not leak.
    const openTagCount = (doc.match(/<script>/gu) ?? []).length;
    const closeTagCount = (doc.match(/<\/script>/gu) ?? []).length;
    expect(openTagCount).toBe(closeTagCount);
  });

  it('implementation note — splices sibling CSS into <style> and sibling HTML into <body>', () => {
    const doc = buildPreviewDocument({
      runId: 'run-1',
      userCode: 'console.log(1);',
      siblingCss: '.hello { color: red; }',
      siblingHtml: '<div id="seed">hello</div>',
    });
    expect(doc).toContain('<style>');
    expect(doc).toContain('.hello { color: red; }');
    expect(doc).toContain('<div id="seed">hello</div>');
  });

  it('omits the <style> block when no sibling CSS is supplied', () => {
    const doc = buildPreviewDocument({ runId: 'run-1', userCode: '' });
    expect(doc).not.toContain('<style>');
  });

  it('escapes a literal style close sequence inside sibling CSS so the tag does not break out', () => {
    // Mirror the script-close test: build the close-style sequence
    // from parts so the test source does not embed a raw close tag.
    const closeStyle = ['<', '/', 'style', '>'].join('');
    const doc = buildPreviewDocument({
      runId: 'run-1',
      userCode: '',
      siblingCss: `.hello { color: red; } ${closeStyle} body { background: red; }`,
    });
    // The escaped variant proves the substitution ran.
    expect(doc).toContain('<\\/style>');
    // The style wrapper opening + closing tags still balance, so a
    // stray close inside the sibling did not split the block.
    const openTagCount = (doc.match(/<style>/gu) ?? []).length;
    const closeTagCount = (doc.match(/<\/style>/gu) ?? []).length;
    expect(openTagCount).toBe(closeTagCount);
  });
});

describe('iframe bridge — isBridgeMessage type guard', () => {
  it('accepts a well-formed console message', () => {
    expect(
      isBridgeMessage({
        __lingua: BRIDGE_DISCRIMINATOR,
        runId: 'abc',
        type: 'console',
        method: 'log',
        args: ['hello', 'world'],
      })
    ).toBe(true);
  });

  it('accepts ready / done / error / unhandledrejection shapes', () => {
    const base = { __lingua: BRIDGE_DISCRIMINATOR, runId: 'abc' };
    expect(isBridgeMessage({ ...base, type: 'ready' })).toBe(true);
    expect(isBridgeMessage({ ...base, type: 'done' })).toBe(true);
    expect(
      isBridgeMessage({ ...base, type: 'error', message: 'boom', lineno: 3 })
    ).toBe(true);
    expect(
      isBridgeMessage({ ...base, type: 'unhandledrejection', message: 'x' })
    ).toBe(true);
  });

  it('rejects a console message without its payload shape (the old envelope-only hole)', () => {
    // Pre-hardening this passed the guard with no method/args at all —
    // user code in the srcdoc realm could post arbitrary non-string args
    // straight into console rendering.
    const base = { __lingua: BRIDGE_DISCRIMINATOR, runId: 'abc' };
    expect(isBridgeMessage({ ...base, type: 'console' })).toBe(false);
    expect(
      isBridgeMessage({ ...base, type: 'console', method: 'table', args: [] })
    ).toBe(false);
    expect(
      isBridgeMessage({
        ...base,
        type: 'console',
        method: 'log',
        args: [{ nested: 'object' }],
      })
    ).toBe(false);
  });

  it('rejects error messages with mistyped optional fields and unknown types', () => {
    const base = { __lingua: BRIDGE_DISCRIMINATOR, runId: 'abc' };
    expect(
      isBridgeMessage({ ...base, type: 'error', message: 'boom', lineno: '3' })
    ).toBe(false);
    expect(isBridgeMessage({ ...base, type: 'error' })).toBe(false);
    expect(isBridgeMessage({ ...base, type: 'spoofed' })).toBe(false);
  });

  it('rejects messages without the discriminator', () => {
    expect(isBridgeMessage({ runId: 'abc', type: 'ready' })).toBe(false);
  });

  it('rejects messages with a wrong discriminator', () => {
    expect(
      isBridgeMessage({ __lingua: 'other', runId: 'abc', type: 'ready' })
    ).toBe(false);
  });

  it('rejects messages without a runId', () => {
    expect(
      isBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, type: 'ready' })
    ).toBe(false);
  });

  it('rejects null / non-object', () => {
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage('hello')).toBe(false);
    expect(isBridgeMessage(undefined)).toBe(false);
  });
});

function tab(overrides: Partial<FileTab>): FileTab {
  return {
    id: overrides.id ?? `tab-${overrides.name ?? 'index'}`,
    name: overrides.name ?? 'index.js',
    language: overrides.language ?? 'javascript',
    content: overrides.content ?? '',
    isDirty: false,
    ...overrides,
  };
}

describe('browser preview sibling source collection', () => {
  it('uses assets from the active tab directory and ignores unrelated open files', () => {
    const active = tab({
      id: 'active',
      name: 'app.js',
      relativePath: 'playground/app.js',
      rootId: 'root-a',
    });
    const sources = collectBrowserPreviewSiblingSources(
      [
        active,
        tab({
          id: 'foreign-css',
          name: 'style.css',
          content: '.foreign { color: red; }',
          relativePath: 'other/style.css',
          rootId: 'root-a',
        }),
        tab({
          id: 'local-css',
          name: 'style.css',
          content: '.local { color: blue; }',
          relativePath: 'playground/style.css',
          rootId: 'root-a',
        }),
        tab({
          id: 'local-html',
          name: 'index.html',
          language: 'javascript',
          content: '<main id="preview"></main>',
          relativePath: 'playground/index.html',
          rootId: 'root-a',
        }),
      ],
      active
    );

    expect(sources).toEqual({
      css: '.local { color: blue; }',
      html: '<main id="preview"></main>',
    });
  });

  it('prefers same-basename assets before generic same-directory assets', () => {
    const active = tab({
      id: 'active',
      name: 'card.ts',
      language: 'typescript',
      relativePath: 'demo/card.ts',
      rootId: 'root-a',
    });
    const sources = collectBrowserPreviewSiblingSources(
      [
        active,
        tab({
          id: 'generic-css',
          name: 'style.css',
          content: '.generic { color: red; }',
          relativePath: 'demo/style.css',
          rootId: 'root-a',
        }),
        tab({
          id: 'same-base-css',
          name: 'card.css',
          content: '.card { color: green; }',
          relativePath: 'demo/card.css',
          rootId: 'root-a',
        }),
      ],
      active
    );

    expect(sources.css).toBe('.card { color: green; }');
  });
});

// Helpers for the runner-execute integration tests.

function createFakeIframe(): HTMLIFrameElement {
  // jsdom-friendly: real iframe element so the runner's srcdoc
  // assignment works without polyfills. We intercept the
  // assignment so the test can drive postMessages directly.
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  return iframe;
}

function postBridgeMessage(
  payload: object,
  options: { origin?: string } = {}
): void {
  // Fire a synthetic MessageEvent so the runner's `window.message`
  // listener picks it up. jsdom dispatches the event on
  // `window`; the runner's `addEventListener` is registered there.
  const event = new MessageEvent('message', {
    data: payload,
    origin: options.origin ?? 'null',
    source: document.querySelector('iframe')?.contentWindow,
  });
  window.dispatchEvent(event);
}

function resetBody(): void {
  // Replace children rather than touching innerHTML so this
  // helper does not look like an unsafe write to static
  // analyzers.
  document.body.replaceChildren();
}

describe('BrowserPreviewRunner — execute()', () => {
  const initialEditor = useEditorStore.getState();

  beforeEach(() => {
    _resetBrowserPreviewBridgeForTesting();
    resetBody();
  });

  afterEach(() => {
    _resetBrowserPreviewBridgeForTesting();
    resetBody();
    useEditorStore.setState(initialEditor, true);
    vi.useRealTimers();
  });

  it('surfaces a clear error when the panel has not mounted', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const result = await runner.execute('console.log(1);');
    expect(result.error?.message).toMatch(/panel|not mounted/i);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('resolves on a done message and captures console output', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('console.log("hello");');

    // Wait one tick so the runner has assigned srcdoc + attached
    // the message listener.
    await Promise.resolve();
    const srcdoc = getSandboxDocument(iframe);
    expect(srcdoc).toContain('console.log("hello");');

    // Extract the runId the runner is listening for. The bridge
    // script in srcdoc carries it as a JSON literal; we grep.
    const runIdMatch = srcdoc.match(/var RUN_ID = "([^"]+)";/u);
    expect(runIdMatch).not.toBeNull();
    const runId = runIdMatch![1]!;

    // Bridge announces ready, then a console log, then done.
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'ready',
    });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'console',
      method: 'log',
      args: ['hello'],
    });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });

    const result = await promise;
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]?.args).toEqual(['hello']);
    expect(result.error).toBeUndefined();
  });

  it('excludes the post-done rejection grace window from execution time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const runner = new BrowserPreviewRunner();
      await runner.init();
      const iframe = createFakeIframe();
      setActiveBrowserPreviewIframe(iframe);
      const promise = runner.execute('// quick');
      await Promise.resolve();
      const runId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
      postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId, type: 'ready' });
      postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId, type: 'done' });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result.error).toBeUndefined();
      expect(result.executionTime).toBeLessThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops messages with a foreign runId', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('// noop');
    await Promise.resolve();
    const srcdoc = getSandboxDocument(iframe);
    const runId = srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;

    // Spoofed message — bypassed.
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: 'attacker-guess',
      type: 'console',
      method: 'error',
      args: ['leaked'],
    });
    // Real done message.
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });

    const result = await promise;
    expect(result.stderr).toEqual([]);
  });

  it('drops messages with a non-allowed origin', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('// noop');
    await Promise.resolve();
    const srcdoc = getSandboxDocument(iframe);
    const runId = srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;

    // Hostile origin — bypassed even with correct runId.
    postBridgeMessage(
      {
        __lingua: BRIDGE_DISCRIMINATOR,
        runId,
        type: 'console',
        method: 'error',
        args: ['hostile'],
      },
      { origin: 'https://attacker.example' }
    );
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });

    const result = await promise;
    expect(result.stderr).toEqual([]);
  });

  it('captures errors and surfaces them as stderr + executionError', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('throw new Error("boom");');
    await Promise.resolve();
    const runId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;

    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at <anonymous>',
    });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });

    const result = await promise;
    expect(result.error?.message).toBe('boom');
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('keeps done provisional so an immediate rejected Promise is not lost', async () => {
    vi.useFakeTimers();
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('Promise.reject(new Error("rejected"));');
    await Promise.resolve();
    const runId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId, type: 'done' });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'unhandledrejection',
      message: 'Error: rejected',
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.kind).toBe('error');
    expect(result.error?.message).toContain('rejected');
    expect(result.stderr).toHaveLength(1);
  });

  it('does not let a superseded run settle after done and mutate the next run', async () => {
    vi.useFakeTimers();
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const first = runner.execute('Promise.reject(new Error("old"));');
    await Promise.resolve();
    const firstRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: firstRunId, type: 'done' });

    const second = runner.execute('document.body.textContent = "new";');
    await Promise.resolve();
    const secondRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'unhandledrejection',
      message: 'Error: old',
    });
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: secondRunId, type: 'done' });

    await vi.advanceTimersByTimeAsync(100);
    expect((await first).kind).toBe('stopped');
    expect((await second).kind).toBe('success');
    expect(getSandboxDocument(iframe)).toContain('textContent = "new"');
  });

  it('keeps the last successful DOM when a silent refresh throws', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const firstRun = runner.execute(
      'document.body.textContent = "stable";',
      { tabId: 'stable-tab', preserveBrowserPreviewOnFailure: true }
    );
    await Promise.resolve();
    const stableDocument = getSandboxDocument(iframe);
    const firstRunId = stableDocument.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'done',
    });
    await firstRun;

    const failedRefresh = runner.execute('throw new Error("new failure");', {
      tabId: 'stable-tab',
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const failedRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: failedRunId,
      type: 'error',
      message: 'new failure',
    });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: failedRunId,
      type: 'done',
    });

    const result = await failedRefresh;
    expect(result.error?.message).toBe('new failure');
    expect(getSandboxDocument(iframe)).toBe(stableDocument);
  });

  it('never restores another tab\'s successful document after a failed refresh', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const first = runner.execute('document.body.textContent = "tab A private";', {
      tabId: 'tab-a',
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const firstRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: firstRunId, type: 'done' });
    await first;

    const second = runner.execute('throw new Error("tab B failed");', {
      tabId: 'tab-b',
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const secondRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: secondRunId,
      type: 'error',
      message: 'tab B failed',
    });
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: secondRunId, type: 'done' });
    expect((await second).kind).toBe('error');
    expect(getSandboxDocument(iframe)).toBe('');
  });

  it('does not treat two anonymous runs as one trusted document owner', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const first = runner.execute('document.body.textContent = "anonymous private";');
    await Promise.resolve();
    const firstRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: firstRunId, type: 'done' });
    await first;

    const second = runner.execute('throw new Error("anonymous failure");', {
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const secondRunId = getSandboxDocument(iframe).match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: secondRunId,
      type: 'error',
      message: 'anonymous failure',
    });
    postBridgeMessage({ __lingua: BRIDGE_DISCRIMINATOR, runId: secondRunId, type: 'done' });
    await second;
    expect(getSandboxDocument(iframe)).toBe('');
  });

  it('restores the last successful DOM into a remounted preview iframe', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const firstIframe = createFakeIframe();
    setActiveBrowserPreviewIframe(firstIframe);

    const firstRun = runner.execute('document.body.textContent = "stable";', {
      tabId: 'remounted-tab',
    });
    await Promise.resolve();
    const stableDocument = getSandboxDocument(firstIframe);
    const firstRunId = stableDocument.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'done',
    });
    await firstRun;

    firstIframe.remove();
    const remountedIframe = createFakeIframe();
    setActiveBrowserPreviewIframe(remountedIframe);
    const failedRefresh = runner.execute('throw new Error("remount failure");', {
      tabId: 'remounted-tab',
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const failedRunId = getSandboxDocument(remountedIframe).match(
      /var RUN_ID = "([^"]+)";/u
    )![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: failedRunId,
      type: 'error',
      message: 'remount failure',
    });
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: failedRunId,
      type: 'done',
    });

    const result = await failedRefresh;
    expect(result.error?.message).toBe('remount failure');
    expect(getSandboxDocument(remountedIframe)).toBe(stableDocument);
  });

  it('seeds the sibling css and html tabs of the tab named by context.tabId', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);
    const active = tab({
      id: 'active',
      name: 'app.js',
      relativePath: 'demo/app.js',
      rootId: 'root-a',
    });
    useEditorStore.setState({
      tabs: [
        active,
        tab({
          id: 'css',
          name: 'style.css',
          content: '.seeded { color: teal; }',
          relativePath: 'demo/style.css',
          rootId: 'root-a',
        }),
        tab({
          id: 'html',
          name: 'index.html',
          content: '<p id="seeded">hi</p>',
          relativePath: 'demo/index.html',
          rootId: 'root-a',
        }),
      ],
      activeTabId: 'active',
    });

    const promise = runner.execute('// noop', { tabId: 'active' });
    await Promise.resolve();
    const srcdoc = getSandboxDocument(iframe);
    expect(srcdoc).toContain('.seeded { color: teal; }');
    expect(srcdoc).toContain('<p id="seeded">hi</p>');

    const runId = srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });
    await promise;
  });

  it('reads the seed at execute time, so the next run sees the edited sibling', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);
    const active = tab({ id: 'active', name: 'app.js' });
    const css = tab({ id: 'css', name: 'style.css', content: '.first { color: red; }' });
    useEditorStore.setState({ tabs: [active, css], activeTabId: 'active' });

    const first = runner.execute('// noop', { tabId: 'active' });
    await Promise.resolve();
    expect(getSandboxDocument(iframe)).toContain('.first { color: red; }');
    runner.stop();
    await first;

    useEditorStore.setState({
      tabs: [active, { ...css, content: '.second { color: blue; }' }],
      activeTabId: 'active',
    });
    const second = runner.execute('// noop', { tabId: 'active' });
    await Promise.resolve();
    expect(getSandboxDocument(iframe)).toContain('.second { color: blue; }');
    expect(getSandboxDocument(iframe)).not.toContain('.first { color: red; }');
    runner.stop();
    await second;
  });

  it('runs without a seed when the context names no tab or the lookup throws', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);
    useEditorStore.setState({
      tabs: [
        tab({ id: 'active', name: 'app.js' }),
        tab({ id: 'css', name: 'style.css', content: '.unseeded { color: red; }' }),
      ],
      activeTabId: 'active',
    });

    // No tabId: the manager execute path (benchmarks) never names a tab.
    const anonymous = runner.execute('// noop');
    await Promise.resolve();
    expect(getSandboxDocument(iframe)).not.toContain('.unseeded');
    runner.stop();
    await anonymous;

    // A throwing store read degrades to a plain run instead of failing it.
    const getState = vi.spyOn(useEditorStore, 'getState').mockImplementationOnce(() => {
      throw new Error('store unavailable');
    });
    const degraded = runner.execute('// noop', { tabId: 'active' });
    await Promise.resolve();
    const srcdoc = getSandboxDocument(iframe);
    expect(srcdoc).not.toContain('.unseeded');
    getState.mockRestore();

    const runId = srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });
    await expect(degraded).resolves.toMatchObject({ kind: 'success' });
  });

  it('times out by clearing srcdoc + resolving with the timeout result', async () => {
    vi.useFakeTimers();
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('while(true){}', { timeout: 500 });
    // Pump the microtask queue so srcdoc has been assigned and the
    // setTimeout is scheduled.
    await Promise.resolve();
    expect(getSandboxDocument(iframe).length).toBeGreaterThan(0);

    vi.advanceTimersByTime(600);
    const result = await promise;
    expect(getSandboxDocument(iframe)).toBe('');
    expect(result.error?.message).toMatch(/timed out/i);
  });

  it('restores the last successful DOM when a silent refresh times out', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const firstRun = runner.execute('document.body.textContent = "stable";', {
      tabId: 'timeout-tab',
    });
    await Promise.resolve();
    const stableDocument = getSandboxDocument(iframe);
    const firstRunId = stableDocument.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'done',
    });
    await firstRun;

    vi.useFakeTimers();
    const timedOutRefresh = runner.execute('while (true) {}', {
      tabId: 'timeout-tab',
      timeout: 500,
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    vi.advanceTimersByTime(600);

    const result = await timedOutRefresh;
    expect(result.error?.message).toMatch(/timed out/i);
    expect(getSandboxDocument(iframe)).toBe(stableDocument);
  });

  it('stop() during an in-flight run cancels the promise', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('// long');
    await Promise.resolve();
    runner.stop();
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(getSandboxDocument(iframe)).toBe('');
  });
});
