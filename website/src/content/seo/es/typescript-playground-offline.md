---
title: 'TypeScript Playground Offline — Lingua'
description: 'Playground TypeScript offline con Monaco, resultados inline, modo Node.js, vista previa, depuración y format-on-save con Prettier.'
canonical: 'https://linguacode.dev/es/typescript-playground-offline'
ogImage: '/assets/og/typescript-playground-offline.png'
language: typescript
---

# TypeScript Playground — offline, con el entorno explícito

Lingua es un scratchpad TypeScript offline-first basado en Monaco.
Empieza en un Worker aislado, cambia a Node.js local cuando necesites
APIs del host o renderiza código DOM en Vista previa sin enviar tu
fuente a un servidor de compilación.

## Lo que sí corre

- **esbuild-wasm** transpila TypeScript dentro del renderer, sin viajes
  a un servidor.
- El modo Worker ejecuta el resultado con protección de bucles,
  resultados `//=>` inline, auto-log, entrada estándar y salida
  enriquecida.
- Monaco incluye diagnósticos, completions, quick fixes y navegación de
  símbolos para TypeScript.
- El modo Node desktop pretranspila archivos `.ts` y los ejecuta con tu
  Node.js local. Soporta módulos ES, `await` de nivel superior,
  built-ins de Node y `node_modules` del proyecto.
- Vista previa renderiza experimentos DOM en un iframe con CSP estricta.
- El depurador mapea breakpoints, pasos, condiciones, logpoints,
  variables y expresiones observadas a las líneas TypeScript originales.
- Los notebooks ejecutan celdas TypeScript con estado compartido e
  importan o exportan archivos Jupyter `.ipynb` y `.linguanb`.

## Lo que no funciona hoy

- El Worker no expone DOM ni built-ins de Node. Elige Vista previa o
  Node desktop cuando los necesites.
- La instalación npm es exclusiva de desktop y requiere un proyecto
  guardado con `package.json`, red y confirmación explícita.
- Los resultados inline, auto-log y el depurador del Worker no se
  ejecutan dentro del proceso Node del host.

## Tier

TypeScript y JavaScript están disponibles en **Free**. Los planes pagos
agregan pestañas y snippets ilimitados y el conjunto Pro.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
