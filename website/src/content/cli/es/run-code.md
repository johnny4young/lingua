---
title: Ejecuta archivos y proyectos
description: Ejecuta JavaScript, TypeScript, Python, Go, Rust, Ruby o Lua confiable con stdin, argumentos, timeouts y variables explícitas.
order: 10
group: guides
keywords: [ejecutar, proyecto, stdin, argumentos, timeout, entorno, javascript, typescript, python, go, rust, ruby, lua]
---

`lingua run` convierte un archivo o un directorio de proyecto convencional en un comando predecible. Lingua selecciona un runtime instalado, lo inicia sin shell, limita la salida y controla el timeout.

## Ejecuta un archivo

```bash
lingua run ./hello.js
lingua run ./analysis.py
lingua run ./hello.go
lingua run ./hello.rs --timeout 60000
```

JavaScript y TypeScript usan Node.js. Python, Go, Rust, Ruby y Lua usan sus toolchains de terminal. Si falta un runtime, Lingua termina con código 3 e indica la capacidad ausente.

## Pasa stdin sin un pipe frágil

Usa `--stdin` cuando la entrada ya está en un archivo:

```bash
lingua run ./normalize.py --stdin fixtures/raw.txt
```

También funciona un pipe normal:

```bash
printf 'Ada\nGrace\n' | lingua run ./greet.js
```

Una terminal interactiva envía EOF cuando no existe un pipe, así que un programa que lee stdin no queda esperando una entrada invisible.

## Pasa argumentos a tu programa

Coloca las opciones de Lingua antes de `--`. Cada token posterior llega al programa sin cambios:

```bash
lingua run ./scripts/check.ts --timeout 45000 -- --verbose --fix src
```

Este es el workaround cuando tu programa también tiene una opción `--json` o `--quiet`.

## Agrega variables de entorno explícitas

```bash
lingua run ./worker.py \
  --env MODE=development \
  --env FEATURE_X=enabled
```

Puedes repetir `--env`. Lingua no hereda ciegamente todas las variables del proceso padre y bloquea claves de inyección del loader y `NODE_OPTIONS`. Pasa secretos solo cuando sean indispensables; el historial del shell y los logs de CI pueden exponer argumentos.

## Ejecuta un proyecto convencional

```bash
lingua run ./my-project
```

La detección sigue un orden fijo:

1. `package.json`: `scripts.start`, luego `scripts.dev` y después un `main` válido.
2. `go.mod`: `go run .`.
3. `Cargo.toml`: `cargo run --quiet --`.
4. Entradas convencionales como `main.py`, `index.js` o `src/index.ts`.

Si un framework necesita un launcher especial, ejecútalo directamente o apunta Lingua a un archivo que funcione de manera independiente. Lingua no adivina comandos específicos de frameworks.

## Automatiza de forma determinista

Usa `--json` cuando otro programa consuma el resultado y revisa el código de salida:

```bash
if result=$(lingua run ./healthcheck.ts --json); then
  printf '%s\n' "$result" | jq -r '.run.stdout'
else
  printf '%s\n' "$result" | jq -r '.reason' >&2
fi
```

El modo normal transmite la salida mientras corre el programa. El modo JSON guarda la misma salida limitada dentro de un solo documento válido.
