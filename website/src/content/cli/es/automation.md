---
title: Automatiza con salida estable
description: Usa envelopes JSON, modo quiet, códigos, completions y ejecución limitada para crear scripts y jobs de CI confiables.
order: 40
group: automation
keywords: [ci, automatización, json, quiet, código de salida, completion, bash, zsh, fish, sin color]
---

El CLI separa los datos en stdout de los diagnósticos humanos en stderr. Los códigos estables, `--json` y la ejecución limitada lo convierten en un bloque confiable para CI.

## Elige texto o JSON deliberadamente

El modo normal funciona mejor cuando la salida de Lingua será la entrada del siguiente programa:

```bash
lingua utility json-format --input raw.json --quiet > normalized.json
```

El modo JSON funciona mejor cuando un script necesita estado y metadatos:

```bash
result=$(lingua run ./check.ts --json) || status=$?
printf '%s\n' "$result" | jq .
exit "${status:-0}"
```

La salida estructurada nunca contiene secuencias ANSI, incluso con `--color=always`.

## Usa las familias de códigos de salida

| Código | Significado | Respuesta típica |
| --- | --- | --- |
| 0 | correcto | continúa |
| 1 | argumentos o entrada inválidos | corrige la invocación o artefacto |
| 2 | error del runtime o timeout | revisa la salida del programa |
| 3 | capacidad ausente o no compatible | instala o elige un runtime |
| 4 | error interno inesperado | conserva diagnósticos y repórtalo |

## Evita jobs bloqueados

```bash
lingua run ./integration-check.py --timeout 90000 --json
```

El rango permitido es 100–300000 ms y el valor predeterminado es 30000 ms. El timeout y Ctrl+C terminan el árbol de procesos.

## Instala autocompletado

### Bash

```bash
mkdir -p ~/.local/share/bash-completion/completions
lingua completion bash > ~/.local/share/bash-completion/completions/lingua
```

### Zsh

```zsh
mkdir -p ~/.zfunc
lingua completion zsh > ~/.zfunc/_lingua
fpath=(~/.zfunc $fpath)
autoload -Uz compinit && compinit
```

### Fish

```fish
mkdir -p ~/.config/fish/completions
lingua completion fish > ~/.config/fish/completions/lingua.fish
```

La generación es determinista y no usa red, por lo que un script de instalación puede ejecutarla sin contactar servicios.
