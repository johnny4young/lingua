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
| `lingua repro pack <capsule> --entry <path>` | Empaqueta una Capsule de JavaScript y los archivos que elijas en un sobre de reproducción; experimental. |
| `lingua repro review <envelope>` | Muestra lo que pide una reproducción y su token de aprobación; no ejecuta nada. |
| `lingua repro run <envelope> --approve <token>` | Ejecuta una reproducción aprobada dentro de un backend de contención, o la rechaza; experimental. |
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
| `--entry <path>` | `repro pack` | Ruta relativa `.mjs` o `.cjs` donde queda el código de la Capsule. |
| `--file <path>` | `repro pack` | Repítela para agregar un archivo, relativo a `--root`. |
| `--node <major>` | `repro pack` | Versión mayor de Node.js que pide la reproducción. |
| `--approve <token>` | `repro run` | Token de aprobación que imprime `repro review`. |
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

`lingua capsule verify <file> --timeout <ms> --env NAME=value --json` está disponible desde el CLI 1.6.0; en instalaciones anteriores revisa primero `lingua capsule verify --help`. Compara exactamente status, stdout y stderr; no verifica un archivo modificado, seguridad, ejecución hermética ni equivalencia entre motores. Solo acepta baselines exitosos de texto con evidencia completa, y las grabaciones de Python, Go y Ruby web son inconclusas porque el motor de la app es distinto del runtime del CLI. `ok` es verdadero únicamente para verdict `pass`; las diferencias terminan con código 5 y la evidencia inconclusa con 6. Los errores de entrada, capacidades, runtime e internos conservan los códigos 1–4. Replay conserva su contrato de salida basado únicamente en ejecución.


### Casos de regresión (sin publicar, compilaciones desde código)

`lingua capsule verify <file> --target <file> --json`

`lingua capsule verify-suite <suite> --root <directory> --json`

`--target <file>` ejecuta el archivo relativo guardado actual igual que el código capturado (mismo modo de runtime y directorio de trabajo del baseline); `--root <directory>` limita los destinos de la suite y usa el directorio actual por defecto. La suite v1 contiene baselines completos sin cambios, ejecuta hasta 20 casos/4 MiB en serie con un presupuesto total de cinco minutos y devuelve verdict estricto por caso. Importar o mostrar una vista previa nunca ejecuta código. Disponible desde el CLI 1.6.0.

## Reproducciones con permisos (experimental, compilaciones desde código)

`lingua repro pack <capsule> --entry main.mjs --file lib/sum.mjs --root <directory> > repro.json` empaqueta una Capsule de JavaScript y los archivos que elijas en un sobre que niega la red y solo permite escrituras desechables. Se rechaza un archivo que un enlace simbólico saca de la raíz o que no es UTF-8. `lingua repro review repro.json` revisa cada hash, lista los controles obligatorios e imprime un token de aprobación sin ejecutar nada. `lingua repro run repro.json --approve <token> --json` se niega antes de lanzar salvo que un backend de contención aplique cada control obligatorio; todavía no hay ninguno, así que siempre se niega: código 1 si la aprobación ya no corresponde y 3 en los demás casos, con el recibo del rechazo en stdout.
