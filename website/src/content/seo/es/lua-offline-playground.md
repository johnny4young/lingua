---
title: "Lua Offline Playground — Lingua"
description: "Lingua incluye runtime Lua, pero hoy Lua sigue expuesto por la ruta de plugin local y no como lenguaje por defecto."
canonical: "https://linguacode.dev/es/lua-offline-playground"
ogImage: "/assets/og/lua-offline-playground.png"
language: lua
---

# Lua playground — runtime incluido, aún por ruta de plugin local

Lingua lleva un runtime compatible con Lua 5.3 basado en Fengari, pero **hoy Lua sigue expuesto por la ruta de plugin local**, no como lenguaje por defecto en cada shell. El runtime está incluido, pero el flujo actual depende de descubrir el plugin antes de ejecutar un archivo `.lua`.

## Lo que sí corre

- **Fengari** es el runtime detrás del plugin Lua. No requiere binario `lua` / `luajit` cuando esa ruta está activa.
- Monaco trae resaltado de sintaxis Lua.
- Hay completions de keywords del vocabulario estándar Lua.
- `print(...)` se captura y se muestra en el panel de resultados inline.

## Lo que no funciona hoy

- Lua no aparece como lenguaje built-in por defecto en el menú New File.
- La versión web no expone la ruta de plugin Lua.
- No hay format-on-save para Lua.
- No hay debugger ni inteligencia LSP-grade.
- No hay flujo `luarocks` / dependencias nativas.

## Tier

Cuando la ruta de plugin Lua local está habilitada, Lua corre en todos los tiers. No hay paywall Pro para snippets Lua.

## Descargar

Descarga Lingua en **[https://linguacode.dev/es](https://linguacode.dev/es)**. Source-available bajo la Licencia Comercial de Lingua.
