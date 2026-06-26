---
title: "TypeScript Playground Offline — Lingua"
description: "An offline TypeScript playground with Monaco, inline results, format-on-save, and full worker-runtime parity. Source-available."
canonical: "https://linguacode.dev/typescript-playground-offline/"
ogImage: "/assets/og/typescript-playground-offline.png"
language: typescript
---

# TypeScript Playground — fully offline, full Monaco

The official TypeScript Playground is excellent, but it needs a
browser tab and a network connection. Lingua is an offline-first
desktop app built around the same Monaco editor, with real inline
execution of the transpiled output.

## What actually runs

- **esbuild-wasm** transpiles TypeScript to JavaScript inside the
  renderer — no server round-trip, no compile server.
- The transpiled JS executes in a Web Worker with source-level AST
  instrumentation (loop protection, magic comments, `//=>` inline
  results).
- Monaco ships the same TypeScript language service you know from VS
  Code: diagnostics, quick fixes, symbol navigation.
- Format-on-save uses Prettier Standalone for `.ts` / `.tsx`.
- Project Search and Quick Open index your TypeScript codebase so
  fuzzy-finding symbols and files is fast.
- Desktop Node mode runs `.ts` / `.js` on your local Node toolchain —
  `import` and top-level `await` execute as ES modules, with Node
  built-in types (`crypto`, `fs`, …) resolved in the editor.
- Cell-based notebooks run TypeScript cells, share variables across
  cells, and import/export Jupyter `.ipynb` (plus the native
  `.linguanb`).

## What doesn't work today

- The in-browser Worker stays sandboxed and does not expose Node
  built-ins — use the desktop Node mode (above) when you need them.
- No `npm install` yet; in-editor imports resolve to the bundled
  TypeScript runtime only.

## Pricing

TypeScript and JavaScript are available in the **Free** tier. You do
not need a paid license to run TS in Lingua.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**. Source-
available commercial license.
