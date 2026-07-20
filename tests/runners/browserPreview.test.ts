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
 *     entries inline, and fires `setSiblingSources` through into
 *     the rendered srcdoc.
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
  it('posts the done message via a microtask so sync console flushes first', () => {
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
  beforeEach(() => {
    _resetBrowserPreviewBridgeForTesting();
    resetBody();
  });

  afterEach(() => {
    _resetBrowserPreviewBridgeForTesting();
    resetBody();
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
    const srcdoc = iframe.srcdoc;
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

  it('drops messages with a foreign runId', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const promise = runner.execute('// noop');
    await Promise.resolve();
    const srcdoc = iframe.srcdoc;
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
    const srcdoc = iframe.srcdoc;
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
    const runId = iframe.srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;

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

  it('keeps the last successful DOM when a silent refresh throws', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const firstRun = runner.execute(
      'document.body.textContent = "stable";',
      { preserveBrowserPreviewOnFailure: true }
    );
    await Promise.resolve();
    const stableDocument = iframe.srcdoc;
    const firstRunId = stableDocument.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'done',
    });
    await firstRun;

    const failedRefresh = runner.execute('throw new Error("new failure");', {
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const failedRunId = iframe.srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;
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
    expect(iframe.srcdoc).toBe(stableDocument);
  });

  it('restores the last successful DOM into a remounted preview iframe', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const firstIframe = createFakeIframe();
    setActiveBrowserPreviewIframe(firstIframe);

    const firstRun = runner.execute('document.body.textContent = "stable";');
    await Promise.resolve();
    const stableDocument = firstIframe.srcdoc;
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
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    const failedRunId = remountedIframe.srcdoc.match(
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
    expect(remountedIframe.srcdoc).toBe(stableDocument);
  });

  it('honors implementation note sibling sources via setSiblingSources', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    runner.setSiblingSources({
      css: '.x { color: red; }',
      html: '<div id="seed">hello</div>',
    });

    const promise = runner.execute('// noop');
    await Promise.resolve();
    const srcdoc = iframe.srcdoc;
    expect(srcdoc).toContain('.x { color: red; }');
    expect(srcdoc).toContain('<div id="seed">hello</div>');

    const runId = srcdoc.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId,
      type: 'done',
    });
    await promise;
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
    expect(iframe.srcdoc.length).toBeGreaterThan(0);

    vi.advanceTimersByTime(600);
    const result = await promise;
    expect(iframe.srcdoc).toBe('');
    expect(result.error?.message).toMatch(/timed out/i);
  });

  it('restores the last successful DOM when a silent refresh times out', async () => {
    const runner = new BrowserPreviewRunner();
    await runner.init();
    const iframe = createFakeIframe();
    setActiveBrowserPreviewIframe(iframe);

    const firstRun = runner.execute('document.body.textContent = "stable";');
    await Promise.resolve();
    const stableDocument = iframe.srcdoc;
    const firstRunId = stableDocument.match(/var RUN_ID = "([^"]+)";/u)![1]!;
    postBridgeMessage({
      __lingua: BRIDGE_DISCRIMINATOR,
      runId: firstRunId,
      type: 'done',
    });
    await firstRun;

    vi.useFakeTimers();
    const timedOutRefresh = runner.execute('while (true) {}', {
      timeout: 500,
      preserveBrowserPreviewOnFailure: true,
    });
    await Promise.resolve();
    vi.advanceTimersByTime(600);

    const result = await timedOutRefresh;
    expect(result.error?.message).toMatch(/timed out/i);
    expect(iframe.srcdoc).toBe(stableDocument);
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
    expect(iframe.srcdoc).toBe('');
  });
});
