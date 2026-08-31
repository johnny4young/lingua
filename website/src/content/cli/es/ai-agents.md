---
title: Verifica código generado por IA con un agente
description: Instala la skill portable de Lingua y convierte ejecuciones locales, validaciones de Capsules y utilidades en evidencia estructurada y honesta.
order: 45
group: automation
keywords:
  [
    agente,
    agentes,
    ia,
    verificación,
    codex,
    claude code,
    copilot,
    skill,
    plugin,
    json,
    evidencia,
    mcp,
  ]
---

Lingua ya ofrece la parte importante para los agentes que pueden usar una terminal: un CLI local
con JSON estable, códigos de salida deterministas, output acotado y fallos de runtime explícitos.
La skill portable `lingua-verify` enseña al agente a usar ese contrato en lugar de adivinar si el
código generado funcionó.

La integración contiene solo instrucciones. No agrega servicios en segundo plano, servidores MCP,
hooks, credenciales ni instaladores automáticos.

## Instala primero el CLI

En macOS, Homebrew instala el CLI y Node.js 24:

```bash
brew install johnny4young/tap/lingua-cli
lingua --version
```

En cualquier plataforma compatible con Node.js 24:

```bash
npm install -g @linguacode/cli
lingua --version
```

La skill requiere Lingua CLI 1.3.0 o posterior. Comprueba la versión, pero nunca instala software
por ti.

## Instala la Agent Skill

### VS Code y GitHub Copilot

Ejecuta **Chat: Install Plugin From Source** desde la paleta de comandos e ingresa:

```text
https://github.com/johnny4young/lingua
```

Revisa el repositorio y confirma que confías en él antes de activar el plugin. VS Code descubre el
`plugin.json` de la raíz y el directorio `skills/lingua-verify`.

### Codex

Invoca el instalador de skills incluido y pídele instalar el directorio público:

```text
$skill-installer
Instala skills/lingua-verify desde https://github.com/johnny4young/lingua
```

La skill instalada queda disponible en el siguiente turno de Codex. Después menciona
`$lingua-verify` o pídele a Codex verificar un script local confiable con Lingua.

### Claude Code

Clona o descarga el repositorio y copia o enlaza `skills/lingua-verify` en:

```text
~/.claude/skills/lingua-verify
```

Si `~/.claude/skills` no existía cuando inició la sesión actual, reinicia Claude Code una vez para
que comience a observar el nuevo directorio principal.

Invócala como `/lingua-verify` o describe una tarea de verificación que coincida con la skill.

## Dale al agente una tarea acotada

Los mejores prompts nombran el objetivo confiable y la evidencia que quieres:

```text
Usa Lingua para ejecutar ./scripts/normalize.ts con --check como argumento del programa.
Reporta el runtime exacto, código de salida, stdout, stderr, duración y cualquier truncamiento.
```

```text
Valida ./artifacts/run.capsule.json sin ejecutarlo. Si es válido, detente antes del replay.
```

```text
Usa la utilidad json-format de Lingua sobre ./fixtures/payload.json y reporta los fallos estructurados.
```

La skill elige el comando más limitado:

| Objetivo                                 | Comando                                        |
| ---------------------------------------- | ---------------------------------------------- |
| Ejecutar un archivo o proyecto confiable | `lingua run <objetivo> --json`                 |
| Validar sin ejecutar                     | `lingua capsule validate <archivo> --json`     |
| Reproducir una captura confiable         | `lingua capsule replay <archivo> --json`       |
| Descubrir transformaciones               | `lingua list utilities --json`                 |
| Aplicar una transformación               | `lingua utility <id> --input <archivo> --json` |

No reemplaza los gates de lint, tipos o pruebas del repositorio.

## Lee la evidencia, no solo el código de salida

El agente comprueba el código de salida y el cuerpo JSON:

| Salida | Significado                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| `0`    | El comando terminó; revisa el resultado estructurado antes de afirmar que quedó verificado. |
| `1`    | Argumentos o entrada inválidos.                                                             |
| `2`    | Fallo del runtime, timeout, detención o salida distinta de cero.                            |
| `3`    | Capacidad no compatible o runtime ausente.                                                  |
| `4`    | Fallo interno no clasificado.                                                               |

Un replay puede terminar correctamente mientras `comparison.matches` sea `false`. Eso es una
divergencia reproducible del output, no una coincidencia.

## Mantén explícito el límite de ejecución

`lingua run` y `lingua capsule replay` se ejecutan con los permisos de tu usuario del sistema
operativo. Lingua evita interpolar mediante shell, filtra variables heredadas, limita el output y
controla el timeout, pero no es un sandbox del sistema operativo.

- Ejecuta solo un objetivo confiable dentro del workspace activo.
- No permitas que un agente instale Lingua o un runtime ausente silenciosamente.
- No envíes secretos mediante `--env`.
- Prefiere validar una Capsule cuando no sea necesario ejecutar.
- Coloca el código no confiable en un sandbox o contenedor bajo tu control.

## Por qué no es otro servidor MCP

El CLI ya es el camino más corto para agentes de código con acceso a una terminal. La skill agrega
conocimiento del workflow y evidencia honesta sin crear otro proceso ni ampliar permisos. El MCP
local existente en Lingua Desktop sigue siendo la opción de solo lectura para exponer un proyecto
aprobado explícitamente a un cliente MCP de confianza.

Un futuro adaptador MCP por stdio solo debería existir si el descubrimiento estructurado de
herramientas resulta más útil que este camino basado en el CLI. Exponer ejecución también exigiría
un diseño de permisos separado.
