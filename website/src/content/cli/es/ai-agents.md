---
title: Verifica código generado por IA con un agente
description: Instala la skill portable de Lingua y convierte ejecuciones locales, validaciones de Capsules y utilidades en evidencia estructurada y honesta.
order: 45
group: automation
heroCommand: --version
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

## Verifica los prerrequisitos

La skill contiene instrucciones, no el CLI ni los runtimes de cada lenguaje. Necesitas:

- un cliente de agentes que pueda ejecutar comandos locales de terminal;
- acceso HTTPS a GitHub mientras instalas la skill;
- Lingua CLI 1.3.0 o posterior en `PATH`;
- el runtime de línea de comandos utilizado por el código que vas a ejecutar.

| Cliente                  | Requisitos de instalación                                                              |
| ------------------------ | -------------------------------------------------------------------------------------- |
| VS Code + GitHub Copilot | VS Code actualizado, acceso a Copilot, Git y `chat.plugins.enabled: true`              |
| Codex                    | `$skill-installer` incluido, acceso de red a GitHub y una carpeta de skills escribible |
| Claude Code              | Claude Code actualizado con `claude plugin`, Git y acceso HTTPS a GitHub               |

## Instala primero el CLI

En macOS, Homebrew instala el CLI y Node.js 24:

```bash
brew install johnny4young/tap/lingua-cli
lingua --version
```

En Windows, Linux o macOS con Node.js 24 y npm:

```bash
npm install -g @linguacode/cli
lingua --version
```

La fórmula de Homebrew instala Node.js 24. La opción npm requiere Node.js 24.x, npm y una ubicación
global escribible cuyo directorio de binarios esté en `PATH`. No uses un `sudo npm install` sin
revisar para ocultar un problema de permisos; corrige el prefijo de npm o usa una instalación de
Node limitada a tu usuario.

Los archivos independientes para Windows x64 y Linux x64 pueden ejecutar utilidades y validar
Capsules sin una instalación separada de Node. Ejecutar o reproducir JavaScript o TypeScript todavía
requiere Node.js 24 en `PATH`. La skill requiere Lingua CLI 1.3.0 o posterior, comprueba la versión y
nunca instala software por ti.

La ejecución también necesita el runtime del objetivo:

| Objetivo                | Runtime en `PATH`                                          |
| ----------------------- | ---------------------------------------------------------- |
| JavaScript / TypeScript | Node.js 24.x                                               |
| Python                  | `.venv` del proyecto, `PYTHON`, `python3`, `python` o `py` |
| Go                      | `go`                                                       |
| Archivo/proyecto Rust   | `rustc` / `cargo`                                          |
| Ruby                    | `ruby`                                                     |
| Lua                     | `lua`                                                      |

## Instala la Agent Skill

### VS Code y GitHub Copilot

Ejecuta **Chat: Install Plugin From Source** desde la paleta de comandos e ingresa:

```text
https://github.com/johnny4young/lingua
```

Revisa el repositorio y confirma que confías en él antes de activar el plugin. VS Code descubre el
`plugin.json` de la raíz y el directorio `skills/lingua-verify`. Si el comando no aparece, actualiza
VS Code, confirma tu acceso a GitHub Copilot y activa `chat.plugins.enabled`.

### Codex

Invoca el instalador de skills incluido y pídele instalar el directorio público:

```text
$skill-installer
Instala skills/lingua-verify desde https://github.com/johnny4young/lingua
```

La skill instalada queda disponible en el siguiente turno de Codex. Después menciona
`$lingua-verify` o pídele a Codex verificar un script local confiable con Lingua.

### Claude Code

Agrega el marketplace de Lingua e instala el plugin nativo. Los comandos son iguales en terminales
de macOS, Linux y Windows:

```bash
claude plugin marketplace add https://raw.githubusercontent.com/johnny4young/lingua/main/.claude-plugin/marketplace.json --scope user
claude plugin install lingua@linguacode --scope user
```

Después de instalarlo desde una terminal, inicia una sesión nueva de Claude Code o ejecuta
`/reload-plugins` dentro de la sesión actual. Invoca la skill con namespace como
`/lingua:lingua-verify` o describe una tarea de verificación que coincida. Claude administra el
caché, las actualizaciones y la desinstalación:

```bash
claude plugin update lingua@linguacode
claude plugin uninstall lingua@linguacode
```

Para probar el plugin desde un checkout local, sin instalarlo ni cambiar tu configuración personal:

```bash
claude --plugin-dir ./skills
```

Después invoca `/lingua:lingua-verify`. El marketplace público resuelve la rama predeterminada del
repositorio, así que no permite instalar la cabecera de un pull request hasta que se integre. Si un
entorno administrado bloquea marketplaces de terceros, un administrador puede revisar y copiar
`skills/lingua-verify` al directorio de skills de Claude aprobado; esa alternativa pierde el ciclo
nativo de actualización y desinstalación.

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
