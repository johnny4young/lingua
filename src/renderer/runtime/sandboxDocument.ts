import sandboxUrl from './lingua-sandbox.htm?url&no-inline';

interface SandboxDocument {
  html: string;
  cancel: () => void;
}
const documents = new WeakMap<HTMLIFrameElement, SandboxDocument>();

export function getSandboxDocument(iframe: HTMLIFrameElement): string {
  return documents.get(iframe)?.html ?? '';
}

export function clearSandboxDocument(iframe: HTMLIFrameElement): void {
  documents.get(iframe)?.cancel();
  documents.delete(iframe);
  iframe.removeAttribute('srcdoc');
  iframe.src = 'about:blank';
}

/**
 * URL navigation gives the opaque sandbox its own CSP. srcdoc/blob/data would
 * inherit the shell policy and block legitimate user scripts. Each navigation
 * has a fresh token so a late ready event cannot receive a replacement run.
 * The returned cleanup only owns this document, never a subsequent one.
 */
export function setSandboxDocument(iframe: HTMLIFrameElement, html: string): () => void {
  // Navigate directly to the replacement. An intermediate about:blank load
  // creates a second transient document and can race the new frame context.
  documents.get(iframe)?.cancel();
  documents.delete(iframe);
  iframe.removeAttribute('srcdoc');
  const token = crypto.randomUUID();
  const url = new URL(sandboxUrl, window.location.href);
  url.searchParams.set('load', token);
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
    const message = event.data;
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'lingua-sandbox-ready' ||
      !('token' in message) ||
      message.token !== token
    )
      return;
    window.removeEventListener('message', receive);
    iframe.contentWindow?.postMessage({ type: 'lingua-sandbox-document', token, html }, '*');
  };
  const state = { html, cancel: () => window.removeEventListener('message', receive) };
  documents.set(iframe, state);
  window.addEventListener('message', receive);
  try {
    iframe.src = url.href;
  } catch (error) {
    clearSandboxDocument(iframe);
    throw error;
  }
  return () => {
    if (documents.get(iframe) === state) clearSandboxDocument(iframe);
  };
}
