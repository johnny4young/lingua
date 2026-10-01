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
| `lingua capsule verify <file>` | Comparación estricta del source capturado; comando de build desde source, aún no publicado. |
| `lingua run <file-or-directory>` | Ejecuta un archivo o proyecto convencional. |
| `lingua list utilities` | Imprime el registro actual de utilidades. |
| `lingua completion [bash\|zsh\|fish\|install]` | Detecta e instala autocompletado o genera el script de un shell. |
| `lingua --version` | Imprime la versión del CLI integrada en el build. |
| `lingua --help` | Imprime la ayuda de terminal. |

## Opciones

| Opción | La usa | Significado |
| --- | --- | --- |
| `--input <file>` | `utility` | Lee la entrada de la utilidad desde un archivo. |
| `--option key=value` | `utility` | Repítela para pasar opciones del adaptador. |
| `--stdin <file>` | `run` | Envía el contenido del archivo como stdin. |
| `--timeout <ms>` | `run`, `capsule replay`, `capsule verify` | Detiene después de 100–300000 ms. |
| `--env NAME=value` | `run`, `capsule replay`, `capsule verify` | Repítela para agregar una variable explícita. |
| `--json` | comandos con datos | Emite un documento JSON estructurado. |
| `--quiet` | comandos con datos | Oculta diagnósticos de Lingua, no la salida del comando. |
| `--yes` | `completion` | Aprueba los cambios detectados sin pedir confirmación. |
| `--dry-run` | `completion` | Muestra shells y archivos de destino sin escribir. |
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
| 5 | `verificationFailed` | La verificación estricta detectó diferencias. |
| 6 | `verificationInconclusive` | La evidencia no permite establecer un pass estricto. |

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

## Verificación estricta del source capturado (sin publicar)

`lingua capsule verify <file> --timeout <ms> --env NAME=value --json` está disponible en builds desde el nuevo source, no en el CLI 1.5.1 publicado. Revisa `lingua capsule verify --help` antes de usarlo. Compara exactamente status, stdout y stderr; no verifica un archivo modificado, seguridad, ejecución hermética ni equivalencia entre motores. Solo acepta baselines exitosos de texto con evidencia completa. `ok` es verdadero únicamente para verdict `pass`; las diferencias terminan con código 5 y la evidencia inconclusa con 6. Los errores de entrada, capacidades, runtime e internos conservan los códigos 1–4. Replay conserva su contrato de salida basado únicamente en ejecución.
