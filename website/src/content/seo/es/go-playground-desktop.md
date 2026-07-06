---
title: "Go Playground para Desktop — Lingua"
description: "Un playground Go desktop que ejecuta go build localmente. Resultados inline, gofmt al guardar, editor Monaco y trabajo offline."
canonical: "https://linguacode.dev/es/go-playground-desktop"
ogImage: "/assets/og/go-playground-desktop.png"
language: go
---

# Go Playground — en tu escritorio, usando tu toolchain

La mayoría de "Go playgrounds" son sandboxes remotos. No puedes importar un módulo local, no puedes tocar tu red y esperas turno con todos los demás. Lingua ejecuta Go en tu máquina, mediante tu instalación de Go, dentro de un editor Monaco.

## Lo que sí corre

- `go build` compila a WebAssembly (`GOOS=js GOARCH=wasm`) y el binario WASM corre en un worker dentro de la app.
- El runtime Go WASM (`wasm_exec.js`) se resuelve desde tu instalación, no viene empacado, así Lingua se mantiene compatible con versiones de Go que incluyan ese runtime.
- Los errores de compilación se mapean a markers de Monaco con línea y columna.
- `gofmt` es el formateador por defecto para archivos `.go`.
- Los comentarios inline `//=>` muestran valores junto a la línea que los produjo.

## Lo que no funciona hoy

- Necesitas una toolchain local de Go instalada. La versión web lo muestra como "desktop only" en vez de fallar en silencio.
- Aún no hay integración Go LSP; hoy solo hay completions básicas de Monaco. El camino LSP real está en RL-026.
- No hay debugger integrado; RL-027 mantiene ese diseño.
- Lingua no administra tu `GOPATH` ni tu module proxy.

## Por qué está en el tier pago

La ejecución de Go es un desbloqueo Pro. El tier Free incluye JavaScript, TypeScript y Python.

## Descargar

Descarga Lingua en **[https://linguacode.dev/es](https://linguacode.dev/es)**. Source-available bajo la Licencia Comercial de Lingua. Education ofrece Pro gratis para estudiantes y docentes verificados.
