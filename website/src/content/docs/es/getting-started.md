---
title: Primeros pasos
description: Instala Lingua, ejecuta tu primer snippet en cinco lenguajes y encuentra los atajos que hacen rápido el flujo.
order: 1
section: guide
---

Lingua es un runner de código multi-lenguaje pensado primero para desktop. Lo instalas una vez y tienes JavaScript, TypeScript, Python, Go y Rust listos en una sola ventana con Monaco.

## Descargar

Ve a [linguacode.dev/releases](/es/releases) y descarga el build para tu plataforma. Cada release incluye:

- macOS — instaladores dmg para Apple Silicon e Intel; los zip del updater permanecen adjuntos como metadatos.
- Windows — un `.exe` NSIS x64. Los builds preliminares pueden no estar firmados y mostrar SmartScreen.
- Linux — un AppImage x86_64.

Si quieres verificar con más cuidado, compara la descarga contra `SHA256SUMS.txt`:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## Tu primer snippet

Abre Lingua. El editor inicia con una pestaña JavaScript nueva. Prueba esto:

```js
const stars = await fetch('https://api.github.com/repos/johnny4young/lingua')
  .then(res => res.json())
  .then(repo => repo.stargazers_count);

console.log({ stars });
```

Presiona `Cmd/Ctrl+Enter`. El panel de resultados se actualiza inline.

## Cambiar lenguaje

Abre el menú de lenguaje en la tab strip (o `Cmd/Ctrl+L`) y elige otro lenguaje. La pestaña se reemplaza con un starter snippet real y ejecutable para ese lenguaje. JavaScript, TypeScript y Python funcionan en cada instalación: sus runtimes vienen dentro de Lingua.

Go y Rust delegan en las toolchains que ya tienes en tu máquina. Si `go version` o `rustc --version` funciona en tu terminal, Lingua las detectará automáticamente.

## Toolchains nativas

JavaScript, TypeScript y Python vienen incluidos con Lingua. Los modos nativos
de desktop usan la toolchain instalada en tu máquina:

- **Go:** instala la versión estable actual desde [go.dev/dl](https://go.dev/dl/) y confirma que `go version` funciona.
- **Rust:** instala Rust desde [rustup.rs](https://rustup.rs/) y confirma que `rustc --version` funciona.
- **Node.js:** instala una versión LTS activa desde [nodejs.org](https://nodejs.org/en/download) y confirma que `node --version` funciona.
- **Ruby:** instala una versión compatible desde [ruby-lang.org](https://www.ruby-lang.org/es/documentation/installation/) y confirma que `ruby --version` funciona. El modo automático de Ruby puede seguir usando el runtime WASM incluido cuando Ruby no está disponible en el sistema.

Después de instalar una toolchain, selecciona **Volver a comprobar** en Lingua.
No necesitas reiniciar la aplicación. Si todavía no se detecta, revisa que el
binario esté disponible en el `PATH` que reciben las aplicaciones de desktop.

## Atajos útiles

Unos pocos atajos para que Lingua desaparezca del camino:

- `Cmd/Ctrl+P` — quick-open de snippet.
- `Cmd/Ctrl+Shift+P` — paleta de comandos.
- `Cmd/Ctrl+Enter` — ejecutar pestaña actual.
- `Cmd/Ctrl+\` — alternar el panel de utilidades developer.

Vim mode es opt-in: actívalo en Settings → Editor.

## Offline por defecto

Lingua no necesita conexión para ejecutar código en el build desktop. Pyodide viene dentro del binario, y Go/Rust usan tu toolchain local. La telemetría está desactivada por defecto; actívala desde Settings si quieres ayudar a mejorar la app.

## Siguientes pasos

- [Descargas](/es/releases) — artefactos para cada plataforma y checksums.
- [Precios](/es/pricing) — los cuatro tiers y qué desbloquea cada uno.
- [Privacidad](/es/privacy) — qué recopilamos y qué no.
- [Código en GitHub](https://github.com/johnny4young/lingua) — issues, discusiones y archivo LICENSE.
