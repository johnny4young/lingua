---
title: Resuelve problemas del CLI
description: Corrige command-not-found, toolchains ausentes, timeouts, argumentos, Capsules, color y salida sin ocultar fallas.
order: 50
group: automation
keywords: [problemas, PATH, comando no encontrado, runtime ausente, timeout, argumentos inválidos, color, salida]
---

Empieza por el código de salida exacto y el motivo estable dentro de `error[...]` o del envelope JSON. Así puedes distinguir una entrada inválida, un error de ejecución y una capacidad ausente.

## No se encuentra el comando lingua

Si trabajas desde el código fuente, compila y enlaza desde la raíz:

```bash
pnpm run build:cli
pnpm link --global
command -v lingua
lingua --version
```

Si `pnpm link --global` funciona pero el shell no encuentra el comando, revisa `pnpm bin --global` y agrega ese directorio al `PATH`. Reinicia el shell después de modificar su perfil.

## Falta un runtime

Confirma que el mismo shell encuentre el toolchain:

```bash
node --version
python3 --version
go version
rustc --version
ruby --version
lua -v
```

Una app de escritorio y un login shell pueden heredar valores PATH diferentes. El CLI usa el entorno de la terminal que lo inició, así que valida desde esa terminal exacta.

## Lingua rechaza una opción de mi programa

Separa los dos dominios de argumentos:

```bash
lingua run ./server.ts --timeout 60000 -- --json --port 4000
```

Antes de `--`, las opciones pertenecen a Lingua. Después, cada token pertenece a tu programa.

## El comando agotó el tiempo

Aumenta el límite dentro del rango 100–300000 ms:

```bash
lingua run ./slow-analysis.py --timeout 120000
```

Si el objetivo es un servidor permanente, ejecuta directamente el comando del framework. `lingua run` está diseñado para tareas que terminan.

## La salida quedó truncada

Cada stream stdout y stderr tiene un presupuesto de 1 MiB. Reduce la salida detallada, escribe resultados grandes a un archivo desde el programa o divide el trabajo. `--json` no aumenta el límite.

## Los logs de CI contienen códigos de color

```bash
NO_COLOR=1 lingua run ./check.ts
lingua run ./check.ts --color=never
```

`--color=never` tiene prioridad explícita. JSON y completions siempre salen sin estilos.

## Una Capsule valida, pero replay produce otro resultado

La validación demuestra que el archivo cumple el esquema; no garantiza que el programa sea determinista. El tiempo, valores aleatorios, dependencias locales, respuestas de red y versiones del toolchain pueden cambiar la salida. Revisa `comparison` en modo JSON en vez de tratar cada diferencia como error del CLI.
