---
title: 'JavaScript Code Runner for Desktop — Lingua'
description: 'Run JavaScript in a fast Worker, local Node.js, or an isolated browser preview. Monaco editing, inline results, debugging, and offline-first workflows.'
canonical: 'https://linguacode.dev/javascript-code-runner-desktop'
ogImage: '/assets/og/javascript-code-runner-desktop.png'
language: javascript
---

# JavaScript code runner — choose the runtime your idea needs

A quick calculation should not require a project. A Node API should not
be forced into a browser sandbox. Lingua gives each JavaScript tab an
explicit runtime: a fast isolated Worker for scratchpad code, local
Node.js for host APIs, or Browser preview for DOM experiments.

## What actually runs

- **Worker** is the fast default. It runs in an isolated Web Worker with
  loop protection, inline `//=>` results, auto-log, standard input, and
  rich console output.
- **Node** runs through the Node.js installation on your desktop. Saved
  files resolve near their project, so imports can use local
  `node_modules` and built-ins such as `fs`, `path`, and `http`.
- **Browser preview** renders JavaScript, sibling HTML, and sibling CSS
  in an iframe with a strict Content Security Policy.
- The JavaScript debugger supports breakpoints, stepping, conditional
  breakpoints, logpoints, variables, and watch expressions in Worker
  mode.
- Monaco supplies diagnostics, completions, quick fixes, symbol
  navigation, project search, and Prettier format-on-save.
- In a saved desktop project with `package.json`, the dependency panel
  can detect imports and run a confirmed `npm install` without invoking
  a shell.

## What doesn't work today

- Node, Deno, Bun, and npm installation are desktop-only. The web build
  keeps JavaScript inside browser runtimes.
- Worker mode has no DOM or Node built-ins. Choose Browser preview for
  DOM code or Node for host APIs.
- Node mode executes trusted code with your filesystem and network
  permissions. Worker-only instrumentation such as inline results,
  auto-log, and the debugger does not follow code into Node.
- Installing npm packages requires a saved project with `package.json`
  and network access. Lingua never installs a package without explicit
  confirmation.

## Pricing

JavaScript execution is available in the **Free** tier with up to three
open tabs and five saved snippets. Paid plans add unlimited tabs and
snippets plus the broader Pro toolset.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
