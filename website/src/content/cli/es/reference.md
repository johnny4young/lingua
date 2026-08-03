---
title: Referencia de comandos y opciones
description: Consulta todos los comandos, opciones, límites, modos de salida y códigos estables del CLI de Lingua.
order: 60
group: reference
keywords: [referencia, comando, flag, opción, códigos de salida, ayuda, versión, color, quiet, json]
---

Esta referencia sigue el mismo catálogo estructurado que genera `lingua --help`. El build del website falla si su snapshot del catálogo se separa del código fuente del CLI.

## Comandos

| Comando | Propósito |
| --- | --- |
| `lingua utility <utility-id>` | Ejecuta un adaptador de utilidad compartido. |
| `lingua capsule validate <file>` | Valida una `RunCapsuleV1` sin ejecutarla. |
| `lingua capsule replay <file>` | Verifica y repite una Capsule confiable de una sola fuente. |
| `lingua run <file-or-directory>` | Ejecuta un archivo o proyecto convencional. |
| `lingua list utilities` | Imprime el registro actual de utilidades. |
| `lingua completion bash\|zsh\|fish` | Genera código de autocompletado para el shell. |
| `lingua --version` | Imprime la versión del CLI integrada en el build. |
| `lingua --help` | Imprime la ayuda de terminal. |

## Opciones

| Opción | La usa | Significado |
| --- | --- | --- |
| `--input <file>` | `utility` | Lee la entrada de la utilidad desde un archivo. |
| `--option key=value` | `utility` | Repítela para pasar opciones del adaptador. |
| `--stdin <file>` | `run` | Envía el contenido del archivo como stdin. |
| `--timeout <ms>` | `run`, `capsule replay` | Detiene después de 100–300000 ms. |
| `--env NAME=value` | `run`, `capsule replay` | Repítela para agregar una variable explícita. |
| `--json` | comandos con datos | Emite un documento JSON estructurado. |
| `--quiet` | comandos con datos | Oculta diagnósticos de Lingua, no la salida del comando. |
| `--color <auto\|always\|never>` | todos | Controla los estilos de diagnósticos humanos. |
| `--` | `run` | Envía cada token restante al programa. |
| `--help`, `-h` | todos | Muestra ayuda. |
| `--version`, `-v` | nivel principal | Imprime la versión del CLI. |

## Códigos de salida

| Código | Nombre | Significado |
| --- | --- | --- |
| 0 | `ok` | El comando terminó correctamente. |
| 1 | `userInputError` | Los argumentos, la entrada, el archivo o la forma son inválidos. |
| 2 | `runtimeError` | La ejecución falló, agotó el tiempo, se detuvo o devolvió un código no cero. |
| 3 | `unsupportedCapability` | El runtime, modo, toolchain o salida no es compatible. |
| 4 | `internal` | Una excepción inesperada llegó al límite del CLI. |

## Contrato de salida

Los errores humanos usan una forma fácil de buscar:

```text
lingua run: error[missing-runtime]: Required runtime "lua" is not available on PATH.
```

Con `--json`, el mismo motivo estable aparece en stdout:

```json
{
  "ok": false,
  "reason": "missing-runtime",
  "detail": "Required runtime \"lua\" is not available on PATH."
}
```

Las guías prácticas documentan los envelopes correctos específicos. Los códigos existentes nunca cambian de número.
