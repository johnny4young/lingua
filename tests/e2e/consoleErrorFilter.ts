// implementation — when the BrowserPreview panel mounts its
// sandboxed iframe (`sandbox="allow-scripts"` without
// `allow-same-origin`), Chromium logs a SecurityError if any
// script inside the iframe tries to probe `navigator.serviceWorker`
// (some libraries do this defensively at boot). The error is
// benign for our threat model — the sandbox is the intent — so we
// filter that specific message out of the console-error gate.
const KNOWN_BENIGN_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  /Service worker is disabled because the context is sandboxed/i,
  /Failed to read the '(localStorage|sessionStorage|serviceWorker)' property from 'Window'.*sandboxed/i,
  /document is sandboxed and lacks the 'allow-same-origin'/i,
  // implementation (Monaco cells) — a notebook code cell mounts a Monaco
  // editor only while focused and disposes it on blur (mount-virtualization).
  // When an editor disposes while its TS worker is mid-analysis, Monaco
  // logs its internal `CancellationError` (literal message "Canceled") to
  // the console. It is framework noise from a deliberate disposal, never
  // propagated to app code (so it cannot be caught/suppressed there) and
  // invisible to users. Exact-match so a real app "...Canceled" stays caught.
  /^(Error: )?Canceled$/,
  // internal — the regional-boundary spec deliberately throws this exact,
  // build-gated probe error to prove the shell survives and Retry remounts.
  // React may prepend its exact console.error interpolation template; keep
  // every accepted form start-anchored so unrelated errors cannot hide the
  // probe text in a longer message. No production path can emit the probe
  // because __LINGUA_E2E_HOOKS__ is false.
  /^(?:%o\n\n%s\n\n%s\n )?(?:Error: )?\[E2E\] intentional (?:notebook|sql|http|utilities) workspace render crash(?:\n|$)/,
];

export function isKnownBenignConsoleError(text: string): boolean {
  return KNOWN_BENIGN_CONSOLE_ERROR_PATTERNS.some(pattern => pattern.test(text));
}
