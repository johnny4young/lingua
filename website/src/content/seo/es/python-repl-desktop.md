---
title: 'Python REPL Desktop — Lingua'
description: 'Python offline en una app desktop con Pyodide vendored, resultados inline, Monaco y utilidades developer integradas.'
canonical: 'https://linguacode.dev/es/python-repl-desktop'
ogImage: '/assets/og/python-repl-desktop.png'
language: python
---

# Python REPL desktop — offline desde el primer binario

Lingua incluye Pyodide v0.29.4 dentro del binario desktop. Eso significa que puedes abrir la app sin internet y ejecutar snippets Python en la misma superficie donde también trabajas JS, TS, Go o Rust.

## Lo que sí corre

- Pyodide corre en un worker dedicado con timeouts y límites de salida controlados.
- El runtime viene vendored en desktop; no se descarga desde CDN.
- Los resultados aparecen inline junto al editor.
- La versión web descarga Pyodide en la primera carga y luego lo sirve desde cache de Service Worker.

## Lo que no funciona hoy

- No es un notebook ni intenta reemplazar Jupyter.
- No hay integración completa con paquetes nativos externos.
- El filesystem expuesto al snippet está limitado por el sandbox de la app.

## Tier

Python está disponible en Free junto con JavaScript y TypeScript.

## Descargar

Descarga Lingua en **[https://linguacode.dev/es](https://linguacode.dev/es)**. Telemetría desactivada por defecto, sin recopilar tu código.
