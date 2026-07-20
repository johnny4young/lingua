/**
 * implementation — `html` payload renderer. Renders inside a
 * sandboxed `<iframe>` with `sandbox="allow-scripts"` (NO
 * `allow-same-origin`, NO `allow-top-navigation`) so user-supplied
 * scripts cannot reach the parent window or navigate the top frame.
 *
 * Security:
 *   - Content is supplied via `srcDoc` (no URL navigation).
 *   - The iframe runs in an opaque origin (no `allow-same-origin`)
 *     so direct parent DOM / storage access is blocked. `postMessage`
 *     can still deliver opaque-origin messages, so parent listeners
 *     must keep their own discriminator + run-id gates.
 *   - A document-level CSP meta (the same
 *     `IFRAME_CONTENT_SECURITY_POLICY` the browser-preview iframe
 *     injects) is prepended to the payload so scripts inside the
 *     rich-HTML surface cannot fetch / XHR / WebSocket out — the two
 *     sandboxed-iframe surfaces enforce one network posture.
 *   - `referrerpolicy="no-referrer"` so any in-iframe network call
 *     does not leak the parent URL.
 *
 * Height: `clampHtmlHeight` ensures the iframe never exceeds
 * `MAX_HTML_PAYLOAD_HEIGHT_PX` regardless of the payload's request.
 *
 * Telemetry: invalid payloads (over the size cap, or empty) fire
 * `runtime.rich_media_payload_rejected`.
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputHtml } from '../../../shared/richOutput';
import { clampHtmlHeight, validateHtmlPayload } from '../../../shared/richOutput';
import { IFRAME_CONTENT_SECURITY_POLICY } from '../BrowserPreview/iframeBridge';
import { trackEvent } from '../../utils/telemetry';

interface RichValueHtmlProps {
  payload: RichOutputHtml;
}

export function RichValueHtml({ payload }: RichValueHtmlProps) {
  const { t } = useTranslation();
  const validated = useMemo(() => validateHtmlPayload(payload.html), [payload.html]);
  const height = useMemo(() => clampHtmlHeight(payload.height), [payload.height]);
  // Prepend the shared srcdoc CSP so this surface carries the same
  // no-network policy as the browser-preview iframe. For the typical
  // fragment payload the leading <meta> lands in the implied <head>
  // and applies document-wide.
  const framed = useMemo(
    () =>
      validated === null
        ? null
        : `<meta http-equiv="Content-Security-Policy" content="${IFRAME_CONTENT_SECURITY_POLICY}">${validated}`,
    [validated]
  );

  useEffect(() => {
    if (validated === null) {
      void trackEvent('runtime.rich_media_payload_rejected', {
        kind: 'html',
        reason:
          typeof payload.html !== 'string' || payload.html.length === 0
            ? 'validation-failed'
            : 'size-limit',
      });
    }
  }, [validated, payload.html]);

  if (validated === null) {
    return (
      <span
        className="rounded-md bg-bg-elevated px-2 py-0.5 font-mono text-caption text-fg-subtle"
        data-testid="console-rich-html-rejected"
      >
        {t('console.rich.mediaRejected')}
      </span>
    );
  }

  return (
    <span className="block w-full" data-testid="console-rich-html">
      <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
        {t('console.rich.htmlSandboxed')}
      </span>
      <iframe
        srcDoc={framed ?? undefined}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={t('console.rich.htmlSandboxed')}
        data-testid="console-rich-html-iframe"
        style={{ height: `${height}px` }}
        className="mt-1 block w-full rounded-md border border-border/40 bg-bg"
      />
    </span>
  );
}
