---
title: 'Runner JavaScript para escritorio — Lingua'
description: 'Ejecuta JavaScript en un Worker rápido, Node.js local o una vista previa aislada. Monaco, resultados inline, depuración y trabajo offline-first.'
canonical: 'https://linguacode.dev/es/javascript-code-runner-desktop'
ogImage: '/assets/og/javascript-code-runner-desktop.png'
language: javascript
---

# Runner JavaScript — elige el entorno que necesita tu idea

Un cálculo rápido no debería exigir un proyecto. Una API de Node no
debería quedar atrapada en un sandbox del navegador. Cada pestaña
JavaScript de Lingua puede usar un Worker aislado, Node.js local o una
vista previa para experimentar con el DOM.

## Lo que sí corre

- **Worker** es el entorno rápido por defecto. Incluye protección de
  bucles, resultados `//=>` inline, auto-log, entrada estándar y salida
  enriquecida.
- **Node** usa la instalación de Node.js de tu escritorio. Los archivos
  guardados resuelven cerca de su proyecto, con acceso a `node_modules`
  y built-ins como `fs`, `path` y `http`.
- **Vista previa del navegador** renderiza JavaScript, HTML y CSS
  relacionados dentro de un iframe con una política CSP estricta.
- El depurador JavaScript incluye breakpoints, ejecución paso a paso,
  breakpoints condicionales, logpoints, variables y expresiones
  observadas en modo Worker.
- Monaco aporta diagnósticos, completions, quick fixes, navegación de
  símbolos, búsqueda de proyecto y format-on-save con Prettier.
- En un proyecto desktop guardado con `package.json`, el panel de
  dependencias detecta imports y puede ejecutar un `npm install`
  confirmado sin invocar un shell.

## Lo que no funciona hoy

- Node, Deno, Bun y la instalación npm son exclusivos de desktop. La
  versión web mantiene JavaScript dentro de entornos del navegador.
- El Worker no expone DOM ni built-ins de Node. Elige Vista previa para
  el DOM o Node para APIs del host.
- Node ejecuta código confiable con tus permisos de red y filesystem.
  Los resultados inline, auto-log y el depurador del Worker no se
  trasladan al proceso Node.
- Instalar paquetes npm requiere un proyecto guardado con
  `package.json` y acceso a red. Lingua nunca instala un paquete sin tu
  confirmación explícita.

## Tier

La ejecución de JavaScript está disponible en **Free**, con hasta tres
pestañas abiertas y cinco snippets guardados. Los planes pagos agregan
pestañas y snippets ilimitados y el conjunto Pro.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
