---
title: 'Rust Code Runner para escritorio — Lingua'
description: 'Ejecuta Rust localmente con rustc, inteligencia rust-analyzer, rustfmt, markers de compilación, dependencias y pruebas Cargo.'
canonical: 'https://linguacode.dev/es/rust-code-runner-desktop'
ogImage: '/assets/og/rust-code-runner-desktop.png'
language: rust
---

# Rust code runner — scratchpad local con errores reales

Lingua compila el archivo Rust actual con tu `rustc`, ejecuta el binario
nativo y mapea los errores al editor. Es una forma rápida de aislar una
idea sin pretender reemplazar un workspace Cargo completo.

## Lo que sí corre

- `rustc` compila el archivo actual como Rust 2021 y Lingua ejecuta el
  binario sin invocar un shell.
- Los errores se convierten en markers de Monaco; stdout, stderr y los
  panics aparecen en el panel de resultados.
- `rust-analyzer` aporta diagnósticos, completions, hover y signature
  help en desktop cuando está disponible.
- `rustfmt` maneja format-on-save para archivos `.rs`.
- Los comentarios `//=>` funcionan como en los scratchpads JavaScript
  y TypeScript.
- En un proyecto guardado con `Cargo.toml`, el panel de dependencias
  puede ejecutar un `cargo add` confirmado y el runner de pruebas puede
  correr `cargo test --color never`.

## Lo que no funciona hoy

- Necesitas `rustc` en desktop. La versión web muestra el límite
  desktop-only.
- La inteligencia de lenguaje requiere un binario local
  `rust-analyzer`. Settings ofrece detección, guía de instalación y
  controles de reinicio.
- No hay depurador Rust paso a paso.
- El scratchpad compila un archivo con `rustc`; no ejecuta una
  aplicación Cargo completa. Usa las pruebas de proyecto o la terminal
  integrada para comandos de workspace.

## Por qué está en el tier pago

La ejecución de Rust es una función de los planes pagos. El acceso
Education ofrece los mismos entitlements gratis a estudiantes y
docentes verificados.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
