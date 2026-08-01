---
title: 'TypeScript Playground Offline — Lingua'
description: 'An offline TypeScript playground with Monaco, inline results, Node.js mode, browser preview, debugging, and Prettier format-on-save.'
canonical: 'https://linguacode.dev/typescript-playground-offline'
ogImage: '/assets/og/typescript-playground-offline.png'
language: typescript
---

# TypeScript playground — offline, with the runtime made explicit

Lingua is an offline-first TypeScript scratchpad built around Monaco.
Start in an isolated Worker, switch to local Node.js when you need host
APIs, or render DOM code in Browser preview without sending source to a
compile server.

## What actually runs

- **esbuild-wasm** transpiles TypeScript inside the renderer, with no
  server round-trip.
- Worker mode executes the output with loop protection, inline `//=>`
  results, auto-log, standard input, and rich console output.
- Monaco ships TypeScript diagnostics, completions, quick fixes, and
  symbol navigation.
- Desktop Node mode pre-transpiles `.ts` files and runs them with your
  local Node.js installation. ES modules, top-level `await`, Node
  built-ins, and project-local `node_modules` are supported.
- Browser preview renders DOM experiments in an iframe with a strict
  Content Security Policy.
- The debugger maps breakpoints, stepping, conditional breakpoints,
  logpoints, variables, and watches back to the original TypeScript
  lines.
- Notebooks run TypeScript cells with shared state and import or export
  Jupyter `.ipynb` and native `.linguanb` files.

## What doesn't work today

- Worker mode stays sandboxed: it exposes neither the DOM nor Node
  built-ins. Choose Browser preview or desktop Node when required.
- npm installation is desktop-only and requires a saved project with
  `package.json`, network access, and explicit confirmation.
- Worker-only instrumentation such as inline results, auto-log, and the
  debugger does not run inside the host Node process.

## Pricing

TypeScript and JavaScript execution are available in the **Free** tier.
Paid plans add unlimited tabs and snippets plus the broader Pro toolset.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
