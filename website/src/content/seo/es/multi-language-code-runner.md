---
title: 'Runner multi-lenguaje — Lingua'
description: 'Ejecuta JavaScript, TypeScript, Python, Ruby, Go y Rust en una app desktop offline-first con notebooks, workspaces HTTP/SQL y herramientas de proyecto.'
canonical: 'https://linguacode.dev/es/multi-language-code-runner'
ogImage: '/assets/og/multi-language-code-runner.png'
language: multi
---

# Runner multi-lenguaje — seis runners integrados, una app desktop

Lingua reúne scratchpads, navegación de proyectos, notebooks y
workspaces para developers en una aplicación basada en Monaco. Cada
lenguaje conserva un límite de runtime honesto en vez de pasar por el
mismo sandbox remoto.

## Lo que sí corre

| Lenguaje   | Runtime                                              | ¿Tier Free? |
| ---------- | ---------------------------------------------------- | ----------- |
| JavaScript | Worker, Node desktop o Vista previa                  | Sí          |
| TypeScript | esbuild-wasm más Worker, Node desktop o Vista previa | Sí          |
| Python     | Pyodide en un Worker                                 | Sí          |
| Ruby       | Ruby WASM en web o Ruby del host en desktop          | Sí          |
| Go         | `go build` local a WASM y ejecución en Worker        | Pago        |
| Rust       | `rustc` local a un subproceso nativo                 | Pago        |

Flujos compartidos:

- Edición Monaco, Quick Open, búsqueda y reemplazo de proyecto,
  navegación de símbolos y estado o diff de Git en desktop.
- Resultados inline, entrada estándar donde se soporta, consola
  enriquecida, historial de ejecución y depurador JS/TS.
- Celdas TypeScript, Python y SQL en notebooks con importación y
  exportación Jupyter.
- Workspaces HTTP y SQL con DuckDB.
- Format-on-save con Prettier, gofmt, rustfmt, ruff o black.
- Ayuda de dependencias desktop para npm, Go, Rust y Ruby, además de
  pruebas de proyecto para Vitest, Jest, Pytest, Go y Cargo.

## Lo que no funciona hoy

- Go y Rust requieren toolchains desktop locales. Web muestra esos
  runners como no disponibles.
- Python y Ruby web usan runtimes WASM; los paquetes nativos
  incompatibles quedan fuera de ese modelo.
- La depuración paso a paso está disponible para JavaScript y
  TypeScript, no para Python, Ruby, Go o Rust.
- gopls y rust-analyzer funcionan solo en desktop y requieren sus
  binarios locales.
- Lua sigue detrás de la ruta de descubrimiento de plugins locales, no
  en el flujo integrado de lenguajes.

## Tier

Free incluye los runners JavaScript, TypeScript, Python y Ruby, tres
pestañas abiertas y cinco snippets guardados. Los planes pagos agregan
pestañas y snippets ilimitados, Go, Rust, notebooks, historial y el
conjunto Pro.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
