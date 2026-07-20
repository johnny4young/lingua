/**
 * implementation — bridge protocol between the iframe-isolated
 * user-code context and the parent renderer.
 *
 * Two surfaces live here:
 *
 *   1. `buildBridgeScript(runId)` — a self-contained IIFE injected
 *      as the FIRST `<script>` of the srcdoc. It overrides the
 *      iframe's `console.*` + global error listeners and forwards
 *      every event to `parent.postMessage` with the run id so the
 *      parent can drop stale messages from a previous run.
 *
 *   2. `buildPreviewDocument(...)` — assembles the full HTML
 *      payload (CSP meta + bridge script + optional implementation note
 *      stylesheet/scaffold + user code) that goes into the
 *      iframe's `srcdoc`. Keeping it pure makes the runner unit
 *      test trivial: feed inputs, assert the rendered string.
 *
 * Anti-spoof contract: every payload posted by the bridge carries
 *
 *   { __lingua: 'browser-preview', runId, type, payload }
 *
 * The parent rejects any message whose envelope is missing the
 * `__lingua` discriminator, whose `runId` does not match the active
 * execution, or whose per-type payload shape fails `isBridgeMessage`.
 *
 * The runId is NOT a secret from user code: the bridge IIFE is an
 * inline script in the same srcdoc realm, so user code can read it
 * back out of `document.scripts` and post a well-formed envelope.
 * What the gates actually guarantee is narrower and sufficient: a
 * forged message can only target the CURRENT run's own console
 * surface (stale runs are dropped by the runId/currentRunId match),
 * and the closed-shape validation bounds what the renderer will
 * accept to plain string rows. The real isolation boundary is the
 * sandbox attribute without `allow-same-origin` plus the srcdoc CSP
 * — anything outside the iframe stays unreachable regardless of
 * what is posted.
 */

export interface BridgeConsoleMessage {
  __lingua: 'browser-preview';
  runId: string;
  type: 'console';
  method: 'log' | 'info' | 'warn' | 'error';
  args: string[];
}

export interface BridgeErrorMessage {
  __lingua: 'browser-preview';
  runId: string;
  type: 'error';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
}

export interface BridgeRejectionMessage {
  __lingua: 'browser-preview';
  runId: string;
  type: 'unhandledrejection';
  message: string;
}

export interface BridgeReadyMessage {
  __lingua: 'browser-preview';
  runId: string;
  type: 'ready';
}

export interface BridgeDoneMessage {
  __lingua: 'browser-preview';
  runId: string;
  type: 'done';
}

export type BridgeMessage =
  | BridgeConsoleMessage
  | BridgeErrorMessage
  | BridgeRejectionMessage
  | BridgeReadyMessage
  | BridgeDoneMessage;

/**
 * Discriminator key used in every posted message. Note that BOTH the
 * discriminator and the runId are readable by user code in the same
 * srcdoc realm (the bridge IIFE is an inline script), so neither is a
 * secret — the module header documents what the message gates actually
 * guarantee.
 */
export const BRIDGE_DISCRIMINATOR = 'browser-preview' as const;

/**
 * Strict CSP for the iframe-srcdoc context. Repeats the
 * sandbox-attribute story at the document level (belt + braces).
 *
 *   - `default-src 'none'` — nothing loads by default.
 *   - `script-src 'unsafe-inline'` — only the inline bridge +
 *     user code scripts. No remote fetches.
 *   - `style-src 'unsafe-inline'` — author CSS via `<style>` tags
 *     (implementation note multi-file seed surfaces sibling .css here).
 *   - `img-src data:` — let user code embed inline images for DOM
 *     experiments. No remote image fetches.
 *
 * No `connect-src` — `fetch` / `XHR` / `WebSocket` are blocked.
 * No `frame-src` — nested iframes are blocked.
 */
export const IFRAME_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

/**
 * Serialize the arguments passed to console.* by user code into
 * the string-array shape `ConsoleOutput.args` expects. Anything
 * that can't be cleanly stringified falls back to `[object Type]`.
 * Kept identical to the JS worker's `serializeArg` so console
 * output matches across runtimes.
 */
const SERIALIZER = `
function __linguaSerializeArg(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return value.toString();
  if (value instanceof Error) {
    return value.stack || (value.name + ': ' + value.message);
  }
  try {
    return JSON.stringify(value);
  } catch (cycleOrTooDeep) {
    try { return String(value); } catch (stringifyError) { return '[unserializable]'; }
  }
}
`.trim();

/**
 * The injected bridge IIFE. The runId travels in as a string
 * literal so the iframe context knows which run it belongs to.
 * Escape `</script>` defensively in case a future caller embeds
 * the script template inside an HTML doc dynamically without
 * proper escaping.
 */
export function buildBridgeScript(runId: string): string {
  const safeRunId = JSON.stringify(runId);
  return `
${SERIALIZER}
(function () {
  var RUN_ID = ${safeRunId};
  function post(msg) {
    try {
      parent.postMessage(Object.assign({}, msg, {
        __lingua: '${BRIDGE_DISCRIMINATOR}',
        runId: RUN_ID,
      }), '*');
    } catch (postError) {
      /* parent unreachable; nothing to do */
    }
  }
  var methods = ['log', 'info', 'warn', 'error'];
  methods.forEach(function (method) {
    console[method] = function () {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        args.push(__linguaSerializeArg(arguments[i]));
      }
      post({ type: 'console', method: method, args: args });
    };
  });
  window.addEventListener('error', function (event) {
    post({
      type: 'error',
      message: event.message || 'Uncaught error',
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error && event.error.stack ? String(event.error.stack) : undefined,
    });
    event.preventDefault();
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message;
    if (reason instanceof Error) {
      message = (reason.stack || (reason.name + ': ' + reason.message));
    } else {
      try { message = __linguaSerializeArg(reason); } catch (serializeError) {
        message = 'Unhandled rejection';
      }
    }
    post({ type: 'unhandledrejection', message: message });
    event.preventDefault();
  });
  post({ type: 'ready' });
})();
`.trim();
}

/**
 * The trailing IIFE that signals execution completion. Runs after
 * user code so we can resolve the runner's promise. We schedule a
 * microtask so any pending sync console.* flush first.
 */
export function buildDoneScript(runId: string): string {
  const safeRunId = JSON.stringify(runId);
  return `
(function () {
  var RUN_ID = ${safeRunId};
  Promise.resolve().then(function () {
    try {
      parent.postMessage({
        __lingua: '${BRIDGE_DISCRIMINATOR}',
        runId: RUN_ID,
        type: 'done',
      }, '*');
    } catch (postError) { /* ignore */ }
  });
})();
`.trim();
}

export interface PreviewDocumentInput {
  runId: string;
  /** Active tab content; the JS / TS body to execute. */
  userCode: string;
  /**
   * implementation note — optional companion text from sibling tabs. The
   * runner forwards whatever was discovered (CSS for `<style>`,
   * an HTML fragment to seed `document.body`). Missing entries
   * surface as no-ops.
   */
  siblingCss?: string;
  siblingHtml?: string;
}

/**
 * Build the full HTML payload for the iframe's `srcdoc`. The
 * order is load-bearing:
 *
 *   1. `<meta charset>` + CSP — guards loaded before any script.
 *   2. Bridge IIFE — installs console + error forwarding before
 *      user code can throw.
 *   3. Optional `<style>` from a sibling CSS tab (implementation note).
 *   4. `<body>` seed from sibling HTML tab (implementation note) — falls back
 *      to an empty body so DOM-mutating user code has somewhere
 *      to write.
 *   5. User code as a separate `<script>` so a top-level
 *      `return` in user code is a SyntaxError caught by the
 *      bridge's `error` listener.
 *   6. Done IIFE — fires after user code completes.
 */
export function buildPreviewDocument(input: PreviewDocumentInput): string {
  const bridgeScript = buildBridgeScript(input.runId);
  const doneScript = buildDoneScript(input.runId);
  // User code goes into a `<script>` tag verbatim. Escape only
  // the close-script sequence so a `</script>` literal in user
  // code does not break out of the tag.
  const escapedUserCode = input.userCode.replace(/<\/script>/giu, '<\\/script>');
  // Sibling CSS is embedded inside a `<style>` block. Symmetric to
  // the `</script>` escape above — a stray `</style>` in user CSS
  // would otherwise close the tag and let any trailing characters
  // re-enter HTML parsing mode.
  const escapedSiblingCss = input.siblingCss
    ? input.siblingCss.replace(/<\/style>/giu, '<\\/style>')
    : undefined;
  const cssBlock = escapedSiblingCss
    ? `<style>\n${escapedSiblingCss}\n</style>`
    : '';
  const bodySeed = input.siblingHtml ?? '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${IFRAME_CONTENT_SECURITY_POLICY}" />
  <title>Lingua browser preview</title>
  ${cssBlock}
  <script>${bridgeScript}</script>
</head>
<body>
${bodySeed}
<script>
${escapedUserCode}
</script>
<script>${doneScript}</script>
</body>
</html>`;
}

/** Closed set of console methods the bridge is allowed to relay. */
const BRIDGE_CONSOLE_METHODS: ReadonlySet<string> = new Set([
  'log',
  'info',
  'warn',
  'error',
]);

/**
 * Type guard for messages received on the parent window. Validates the
 * FULL per-type payload shape, not just the envelope: user code in the
 * srcdoc realm can read the runId out of the inline bridge script and
 * post a well-formed envelope, so the runner must never trust `method`
 * or `args` (or the error fields) beyond what this guard proves. A
 * message whose declared `type` does not carry its required shape is
 * dropped, never partially consumed.
 */
export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.__lingua !== BRIDGE_DISCRIMINATOR) return false;
  if (typeof candidate.runId !== 'string') return false;

  const optional = (field: unknown, type: 'string' | 'number'): boolean =>
    field === undefined || typeof field === type;

  switch (candidate.type) {
    case 'console':
      return (
        typeof candidate.method === 'string' &&
        BRIDGE_CONSOLE_METHODS.has(candidate.method) &&
        Array.isArray(candidate.args) &&
        candidate.args.every((arg) => typeof arg === 'string')
      );
    case 'error':
      return (
        typeof candidate.message === 'string' &&
        optional(candidate.source, 'string') &&
        optional(candidate.lineno, 'number') &&
        optional(candidate.colno, 'number') &&
        optional(candidate.stack, 'string')
      );
    case 'unhandledrejection':
      return typeof candidate.message === 'string';
    case 'ready':
    case 'done':
      return true;
    default:
      return false;
  }
}
