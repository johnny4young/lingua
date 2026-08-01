---
title: 'Lua Offline Playground — Lingua'
description: 'Lingua incluye Fengari compatible con Lua 5.3, pero la ejecución sigue detrás de la ruta de plugin local y no del flujo de lenguajes integrados.'
canonical: 'https://linguacode.dev/es/lua-offline-playground'
ogImage: '/assets/og/lua-offline-playground.png'
language: lua
---

# Lua playground — runtime incluido detrás del plugin local

Lingua incluye un runtime Fengari compatible con Lua 5.3, pero Lua no
es un lenguaje integrado por defecto. La ejecución desktop aparece
solo cuando la ruta de descubrimiento de plugins registra el runner.

## Lo que sí corre

- **Fengari** ejecuta Lua en JavaScript puro; el runner registrado no
  necesita un binario `lua` o `luajit` del host.
- Monaco aporta resaltado de sintaxis y completions de keywords Lua.
- La salida de `print(...)` se captura y limita.
- Los límites de ejecución detienen bucles Lua sin fin antes de que
  congelen la app.
- Una vez registrado, la detección de extensiones, badges y dispatch del
  runner usa la misma forma de descriptor que los runners integrados.

## Lo que no funciona hoy

- Lua no aparece por defecto en el menú Nuevo archivo. La ruta de plugin
  desktop debe registrarlo primero.
- La versión web no expone descubrimiento de plugins locales, así que
  hoy esta no es una experiencia Lua web.
- No hay format-on-save, depurador, inteligencia LSP, entrada estándar
  ni salida enriquecida para Lua.
- No existe un flujo de instalación `luarocks` y Fengari no puede
  cargar módulos C nativos.

## Tier

Cuando la ruta de plugin Lua está activa, la ejecución no exige un plan
pago.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
