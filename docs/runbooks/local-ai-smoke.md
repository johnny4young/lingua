# Local AI smoke — "Explain this error" with a real model

How to exercise the **Explain this error** feature end to end against a
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

## Why a plain `http://localhost` endpoint works

Both shells list `http://localhost:*` and `http://127.0.0.1:*` in
`connect-src`; they are the only plain-http origins (a build test in
`tests/build/shellCsp.test.ts` keeps it that way). Dev and production web
behave the same. On the web the server must still allow the Lingua origin;
Ollama reflects CORS for any origin, LM Studio needs its CORS toggle.

## Option A — interactive, in your own browser (recommended)

1. `pnpm run dev:web:pro` and paste the printed token into
   **Settings → Account → License**.
2. **Settings → Account → AI** — leave **Send to** on **Local · Ollama** and
   click **Detect local AI (Ollama)**: it probes
   `http://localhost:11434/v1/models`, fills the Local endpoint and lists your
   installed models to pick. Or fill by hand:
   - Endpoint: `http://localhost:11434/v1/chat/completions`
   - Model: `qwen3-coder:latest`
   The Local profile takes no API key.
3. Trigger an error and click **Explain this error**, then **Send to AI**. The
   trigger appears on: the end of a failing editor line, the editor console (in
   **Run** mode, not Scratchpad — the error must reach the console), a notebook
   code cell, a failed SQL query's error band, and a failed HTTP request's
   error band. On a code tab (the line or the console) it opens the panel
   beside the editor, whose mode control switches between Local · Ollama and
   My endpoint; notebook, SQL and HTTP open the dialog.

On desktop, My endpoint goes through main's HTTP proxy, so a remote provider
needs no CORS. Main blocks private hosts there; a server on this machine
belongs in the Local profile.

## Option B — agent-driven Playwright smoke (no CSP change relied on)

When an agent drives the app via Playwright and should not depend on a
server's CORS, point My endpoint at an HTTPS-shaped fake endpoint and proxy it
to Ollama from the Node side:

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
- Keep plain http limited to the two loopback origins; never add a bare
  `http:` to either CSP.
