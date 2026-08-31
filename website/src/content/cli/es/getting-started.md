---
title: Usa Lingua sin abrir una ventana
description: Conoce el CLI headless de Lingua, compílalo hoy y convierte tu primer comando en un flujo local repetible.
order: 1
group: start
keywords: [instalar, homebrew, brew, npm, terminal, primeros pasos, headless, offline, ayuda]
---

El CLI de Lingua sirve cuando una acción útil debe salir de la app y convertirse en un comando de terminal, un pipe o un paso de CI. Ejecuta las mismas utilidades y el mismo esquema de Run Capsules de Lingua, pero **no** abre Electron ni React.

Es local, automatizable y deliberadamente pequeño. Úsalo para formatear un payload desde stdin, ejecutar un archivo confiable, validar una Capsule en CI o repetir una ejecución capturada.

## Instálalo

En macOS, Homebrew descarga el artefacto oficial del CLI y configura Node 24 automáticamente. No ejecuta npm:

```bash
brew install johnny4young/tap/lingua-cli
lingua --help
```

Esta fórmula es independiente de `brew install --cask johnny4young/tap/lingua`, que instala en `/Applications/lingua.app` la misma aplicación Desktop distribuida en el `.dmg`.

`@linguacode/cli` también continúa disponible en npm para cualquier plataforma compatible con Node. No tiene dependencias de paquete y necesita Node 24.x:

```bash
npm install -g @linguacode/cli
lingua --help
```

¿Prefieres no instalar nada? Ejecútalo una sola vez con `npx`:

```bash
npx @linguacode/cli --help
```

En Windows x64 y Linux x64 puedes usar los archivos independientes `lingua-cli-*-linux-x64.tar.gz` y `-windows-x64.tar.gz` incluidos en cada [GitHub Release](https://github.com/johnny4young/lingua/releases/latest) estable. Las utilidades y la validación de Capsules no requieren una instalación separada de Node; ejecutar o reproducir JavaScript y TypeScript todavía requiere Node.js 24 en `PATH`.

## Compílalo desde el código fuente

Si contribuyes al proyecto, o si sigues `main` antes de una release, compílalo desde el repositorio:

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
corepack enable
pnpm install
pnpm run build:cli
node dist/cli/lingua.cjs --help
```

Para desarrollo local, agrega el comando `lingua` a tu `PATH`:

```bash
pnpm link --global
lingua --version
```

Este enlace apunta a tu checkout. Ejecuta `pnpm run build:cli` después de cambiar el código del CLI.

## Ejecuta tu primer comando útil

Formatea JSON directamente desde otro programa:

```bash
curl -s https://api.github.com/repos/johnny4young/lingua \
  | lingua utility json-format
```

También puedes ejecutar un archivo con el toolchain instalado en tu equipo:

```bash
lingua run ./scripts/check.ts -- --verbose
```

Todo lo que aparece después de `--` pertenece a tu programa, no a Lingua.

## Elige el comando correcto

| Quieres… | Empieza con |
| --- | --- |
| transformar o inspeccionar un valor | `lingua utility` |
| ejecutar un archivo o proyecto convencional | `lingua run` |
| revisar una Capsule sin ejecutarla | `lingua capsule validate` |
| reproducir una ejecución capturada | `lingua capsule replay` |
| descubrir utilidades y sus opciones | `lingua list utilities --json` |
| activar autocompletado | `lingua completion` |

## Un modelo mental seguro

El CLI no interpola tu comando mediante un shell, pero el código que ejecuta `lingua run` conserva tus permisos del sistema operativo. Ejecuta solo código confiable. Para código no confiable, coloca el CLI dentro de un contenedor o sandbox bajo tu control.

El CLI no necesita red. Tu programa sí puede usarla, y cada lenguaje requiere su toolchain local correspondiente.

## Continúa según tu tarea

- [Ejecuta archivos y proyectos](/es/cli/run-code)
- [Conecta utilidades en pipes](/es/cli/utilities)
- [Copia recetas para APIs, repositorios, CI, contenedores y PowerShell](/es/cli/recipes)
- [Valida y repite Run Capsules](/es/cli/capsules)
- [Usa Lingua en scripts y CI](/es/cli/automation)
- [Resuelve problemas de PATH, runtimes y salida](/es/cli/troubleshooting)
- [Consulta comandos, opciones y códigos](/es/cli/reference)
