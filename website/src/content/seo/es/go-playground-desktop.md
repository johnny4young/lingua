---
title: 'Go Playground para escritorio — Lingua'
description: 'Ejecuta Go localmente con go build, inteligencia gopls, gofmt, errores inline, ayuda de dependencias y pruebas de proyecto en desktop.'
canonical: 'https://linguacode.dev/es/go-playground-desktop'
ogImage: '/assets/og/go-playground-desktop.png'
language: go
---

# Go Playground — usa la toolchain de tu escritorio

Lingua ejecuta Go localmente en vez de subir tu código a un playground
compartido. El archivo actual se compila con tu instalación de Go,
mientras las herramientas desktop agregan gopls, dependencias, pruebas,
búsqueda y terminal alrededor de una carpeta aprobada.

## Lo que sí corre

- `go build` compila el archivo actual a WebAssembly con
  `GOOS=js GOARCH=wasm`; el resultado corre en un Worker de la app.
- Los errores de compilación se convierten en markers de Monaco con
  ubicación de fuente.
- `gopls` aporta diagnósticos, completions, hover y signature help en
  desktop cuando el binario está disponible.
- `gofmt` maneja format-on-save para archivos `.go`.
- Los comentarios `//=>` muestran valores junto a la línea que los
  produjo.
- En un proyecto guardado con `go.mod`, el panel de dependencias puede
  ejecutar un `go get` confirmado y el runner de pruebas puede correr
  `go test ./...`.

## Lo que no funciona hoy

- Necesitas Go instalado localmente. La versión web muestra el límite
  desktop-only en vez de simular que puede ejecutar el archivo.
- La inteligencia gopls requiere el binario local `gopls`. Settings
  ofrece detección, guía de instalación y controles de reinicio.
- No hay depurador Go paso a paso.
- El scratchpad compila el archivo actual; no reemplaza un flujo
  completo de `go run` ni administra tu module proxy o caché.

## Por qué está en el tier pago

La ejecución de Go es una función de los planes pagos. El acceso
Education ofrece los mismos entitlements gratis a estudiantes y
docentes verificados.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
