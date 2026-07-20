# Local AI smoke — "Explain this error" with a real model

How to exercise the implementation **Explain this error** feature end to end against a
**real** local model (no mock), on the web build. Covers both interactive use
in your own browser and agent-driven Playwright smokes.

## Prerequisites

- A local OpenAI-compatible server. **Ollama** is easiest:
  ```bash
  ollama serve                 # usually already running on :11434
  ollama pull qwen3-coder      # a code model explains errors well
  ```
  (LM Studio on `:1234` works too — enable its CORS toggle.)
- A Pro license in the app (the feature is gated on `LOCAL_AI`).
  `pnpm run dev:web:pro` prints a token to paste into
  **Settings → Account → License**; then configure AI as shown below.

## Why a plain `http://localhost` endpoint needs help

The web build's CSP is `connect-src 'self' … https:` — it allows any HTTPS
origin but **blocks `http://localhost:11434`**. Ollama itself already reflects
CORS for any origin, so CORS is not the blocker; the CSP is.

Two ways around it, below.

## Option A — interactive, in your own browser (recommended)

`vite serve` (i.e. `dev:web` / `dev:web:pro`) widens `connect-src` to include
`http://localhost:*` and `http://127.0.0.1:*` via a dev-only plugin in
`vite.web.config.mts` (gated on `command === 'serve'`, so a production
`vite build` never relaxes the CSP — verified: `dist/web/index.html` stays
`https:`-only).

1. `pnpm run dev:web:pro` and paste the printed token into
   **Settings → Account → License**.
2. **Settings → Account → AI** — click **Detect local AI (Ollama)**: it
   probes `http://localhost:11434/v1/models`, fills the endpoint + a
   placeholder key, and lists your installed models to pick. Or fill by hand:
   - Endpoint: `http://localhost:11434/v1/chat/completions`
   - API key: anything non-empty (e.g. `ollama`)
   - Model: `qwen3-coder:latest`
3. Trigger an error and click **Explain this error**, then **Send to AI**. The
   trigger appears on: a notebook code cell, the editor console (in **Run**
   mode, not Scratchpad — the error must reach the console), a failed SQL
   query's error band, and a failed HTTP request's error band.

## Option B — agent-driven Playwright smoke (no CSP change relied on)

When an agent drives the app via Playwright, point the app at an HTTPS-shaped
fake endpoint the CSP already allows and proxy it to Ollama from the Node side:

```js
// Config: endpoint 'https://ollama.local/v1/chat/completions', model 'qwen3-coder:latest'
await page.route('https://ollama.local/**', async (route) => {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    return;
  }
  // Use page.request.post — `fetch` is NOT defined in the route handler.
  const resp = await page.request.post('http://localhost:11434/v1/chat/completions', {
    headers: { 'Content-Type': 'application/json' },
    data: route.request().postData() ?? '{}',
    timeout: 55000,
  });
  await route.fulfill({
    status: resp.status(),
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: await resp.text(),
  });
});
```

The model that answers is real; only the transport is bridged.

## Notes

- `DEFAULT_AI_TIMEOUT_MS` is 60 s. Ollama's first call is ~15 s (model load);
  later calls are faster.
- The consent dialog shows the exact payload first and an "N secrets redacted"
  indicator; nothing is sent until you click Send.
- Do **not** commit `http://localhost` into `src/web/index.html`'s CSP — the
  widening must stay in the dev-only Vite plugin so production stays strict.
