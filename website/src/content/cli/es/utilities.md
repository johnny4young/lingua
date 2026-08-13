---
title: Conecta utilidades en pipes
description: Descubre utilidades, transforma stdin o archivos, pasa opciones y mantén predecibles tus pipelines de shell.
order: 20
group: guides
keywords: [utilidad, pipe, entrada, opción, json-format, base64, regex, listar utilidades]
---

`lingua utility` lleva transformaciones enfocadas a la terminal. Los adaptadores se comparten con los paneles de utilidades de Lingua, pero el CLI mantiene un contrato textual apropiado para automatización.

## Descubre antes de adivinar

```bash
lingua list utilities
lingua list utilities --json | jq '.utilities[] | {id, options}'
```

El registro JSON es la forma más segura de descubrir ids, tipos de entrada/salida y opciones aceptadas.

## Lee desde stdin

```bash
echo '{"team":["Ada","Grace"]}' | lingua utility json-format
printf 'hello world' | lingua utility base64-encode
```

Stdin permite conectar utilidades naturalmente con `curl`, `git`, `jq` y otros programas.

## Lee un archivo

```bash
lingua utility json-format --input package.json --option indent=4
lingua utility base64-encode --input README.md
```

`--input` solo pertenece a `utility`. Para el stdin de un programa ejecutado, usa `lingua run --stdin`.

## Repite opciones del adaptador

```bash
lingua utility regex-replace --input src.ts \
  --option pattern='console\\.log' \
  --option flags=g \
  --option replacement=logger.info
```

Cada `--option` acepta un par `key=value`. Usa comillas cuando el valor contenga espacios o caracteres especiales del shell.

## Mantén limpios tus pipelines

`--quiet` elimina los diagnósticos de Lingua, pero conserva la salida correcta:

```bash
lingua utility json-format --input raw.json --quiet > normalized.json
```

Usa `--json` para recibir un envelope estructurado de Lingua, no cuando necesites directamente los bytes transformados:

```bash
lingua utility json-format --input raw.json --json | jq -r '.value'
```

La salida binaria no forma parte de este contrato headless textual. Lingua termina con código 3 en vez de corromper el flujo de la terminal.

Para ver ejemplos con opciones sobre APIs, JWTs, hashes, Unicode,
identificadores, cron, reemplazos de código y más, continúa con [Recetas
prácticas para el desarrollo diario](/es/cli/recipes).
