---
title: "Runner Multi-Lenguaje — Lingua"
description: "Ejecuta JavaScript, TypeScript, Python, Go y Rust en una app desktop offline-first con Monaco y utilidades developer."
canonical: "https://linguacode.dev/es/multi-language-code-runner"
ogImage: "/assets/og/multi-language-code-runner.png"
language: multi
---

# Runner multi-lenguaje — cinco lenguajes, una app desktop

Muchos developers alternan entre tres o cuatro lenguajes en un día. El flujo típico termina en una pestaña de navegador por lenguaje. Lingua lo reúne en una app desktop con Monaco que trata cada lenguaje como ciudadano de primera clase.

## Lo que sí corre

| Lenguaje | Runtime | Tier |
| --- | --- | --- |
| JavaScript | Worker + instrumentación de fuente | Free |
| TypeScript | esbuild-wasm + Worker | Free |
| Python | Pyodide WASM en Worker | Free |
| Go | `go build` local → WASM en Worker | Pro |
| Rust | `rustc` local → subprocess nativo | Pro |

Maquinaria compartida:

- Monaco editor con Quick Open, búsqueda de proyecto y navegación de símbolos.
- Comentarios inline `//=>` o `#=>` para mostrar resultados por línea.
- Format-on-save: Prettier, gofmt, rustfmt y ruff donde corresponde.
- Utilidades developer integradas: JSON formatter, regex, Base64, UUID, hash, timestamps, JWT, color y diff.

## Lo que no funciona hoy

- Go y Rust necesitan toolchains locales; en web se muestran como desktop-only.
- No hay modo notebook todavía.
- No hay debugger.
- No hay LSP más allá de los servicios integrados de Monaco para JavaScript / TypeScript.

## Tier

Free ejecuta JavaScript, TypeScript y Python con una pestaña abierta y hasta 5 snippets guardados. Pro desbloquea Go, Rust y límites más amplios.

## Descargar

Descarga Lingua en **[https://linguacode.dev/es](https://linguacode.dev/es)**. Source-available bajo licencia comercial.
