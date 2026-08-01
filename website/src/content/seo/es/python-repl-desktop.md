---
title: 'Python REPL para escritorio — Lingua'
description: 'Ejecuta Python offline con Pyodide, resultados inline, notebooks, salida enriquecida, paquetes micropip y formato desktop con ruff o black.'
canonical: 'https://linguacode.dev/es/python-repl-desktop'
ogImage: '/assets/og/python-repl-desktop.png'
language: python
---

# Python REPL — sin instalar Python en tu equipo

Lingua ejecuta Python mediante Pyodide en un Worker dedicado. Tu snippet
permanece local y se comporta igual en desktop y web, mientras los
notebooks ofrecen un scope persistente cuando una ejecución aislada no
es suficiente.

## Lo que sí corre

- **Pyodide** aporta Python 3 y su librería estándar incluida sin
  depender de una instalación Python del host.
- `micropip` instala paquetes pure-Python y wheels compatibles con
  Pyodide en la sesión activa.
- Los comentarios `#=>` inline, la entrada estándar, tablas, gráficos,
  imágenes y HTML usan la superficie de resultados compartida.
- Las celdas Python de un notebook comparten variables dentro de ese
  notebook, quedan aisladas de los demás e importan o exportan
  `.ipynb` y `.linguanb`.
- En desktop, format-on-save prefiere `ruff format` y usa `black` como
  alternativa cuando alguno está disponible en `PATH`.
- Debug en desktop usa CPython/pdb del host con breakpoints en el gutter,
  ejecución paso a paso, variables locales, call stack del archivo y watches.
  Usa primero `.venv` o `venv` del proyecto cuando está disponible.
- Los límites de tiempo y salida evitan que un programa descontrolado
  bloquee el shell de la aplicación.

## Lo que no funciona hoy

- `micropip` no puede instalar paquetes que dependan de extensiones
  nativas incompatibles.
- Lingua no crea ni conserva un entorno virtual Python local. Desktop
  sigue ejecutando Pyodide en lugar del CPython del host.
- La depuración de Python solo está disponible en desktop. Los watches se
  ejecutan dentro del proceso local y pueden tener efectos secundarios; los
  breakpoints condicionales y logpoints siguen siendo exclusivos de JS/TS.

## Tier

La ejecución de Python está disponible en **Free**. Los planes pagos
agregan pestañas y snippets ilimitados, notebooks y el conjunto Pro.

## Descargar

Descarga Lingua en
**[https://linguacode.dev/es](https://linguacode.dev/es)**.
Source-available bajo la Licencia Comercial de Lingua.
