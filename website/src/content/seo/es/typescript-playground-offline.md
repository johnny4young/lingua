---
title: "TypeScript Playground Offline — Lingua"
description: "Playground TypeScript offline con Monaco, resultados inline, format-on-save y runtime en Worker. Source-available."
canonical: "https://linguacode.dev/es/typescript-playground-offline"
ogImage: "/assets/og/typescript-playground-offline.png"
language: typescript
---

# TypeScript Playground — offline, con Monaco completo

El TypeScript Playground oficial es excelente, pero necesita una pestaña del navegador y conexión. Lingua es una app desktop offline-first basada en Monaco, con ejecución real del JavaScript transpilado.

## Lo que sí corre

- **esbuild-wasm** transpila TypeScript a JavaScript dentro del renderer, sin servidor de compilación.
- El JS transpilado corre en un Web Worker con instrumentación AST para protección de loops y resultados inline.
- Monaco trae el servicio TypeScript conocido de VS Code: diagnósticos, quick fixes y navegación de símbolos.
- Format-on-save usa Prettier Standalone para `.ts` / `.tsx`.
- Project Search y Quick Open indexan tu codebase TypeScript.

## Lo que no funciona hoy

- No hay modo Node.js todavía; el sandbox Worker no expone built-ins de Node.
- No hay `npm install`; los imports se limitan al runtime incluido.

## Tier

TypeScript y JavaScript están disponibles en Free. No necesitas una licencia paga para ejecutar TS en Lingua.

## Descargar

Descarga Lingua en **[https://linguacode.dev/es](https://linguacode.dev/es)**. Source-available bajo licencia comercial.
