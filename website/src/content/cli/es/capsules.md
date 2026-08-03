---
title: Valida y repite Run Capsules
description: Revisa una RunCapsuleV1, repite capturas confiables de una sola fuente y entiende los límites de integridad y Workspace.
order: 30
group: guides
keywords: [capsule, validar, repetir, RunCapsuleV1, hash, comparación, workspace, confianza]
---

Las Run Capsules conservan un buffer de código, entrada, argumentos, metadatos de entorno y salida registrada. El CLI puede validar ese contrato o repetir su única fuente con un runtime local.

## Valida sin ejecutar

```bash
lingua capsule validate ./run.capsule.json
lingua capsule validate ./run.capsule.json --json
```

La validación revisa el límite de 4 MiB, la sintaxis JSON, la versión del esquema, las migraciones, los campos obligatorios y sus tipos. Nunca ejecuta el código guardado.

Úsala como gate de carga o build:

```bash
for capsule in build/*.capsule.json; do
  lingua capsule validate "$capsule" --quiet || exit 1
done
```

## Repite una fuente confiable

```bash
lingua capsule replay ./run.capsule.json
lingua capsule replay ./run.capsule.json --timeout 60000 --json
```

Replay verifica primero que `source.content` coincida con su hash SHA-256. Después ejecuta el código y compara estado, stdout y stderr con el resultado registrado.

Un comando correcto todavía puede devolver `comparison.matches: false`. Eso es evidencia útil de reproducibilidad, no un error del runtime.

## Conoce el límite de confianza

El hash detecta inconsistencias accidentales. **No es una firma**: quien edita el archivo también puede reemplazar el código y recalcular el hash. Repite únicamente Capsules de fuentes confiables porque el código recibe tus permisos del sistema operativo.

Las Capsules de preview del navegador no se pueden repetir en un proceso headless. Un runtime ausente termina con código 3 en vez de sustituir silenciosamente el modo de ejecución.

## Workaround para Capsule Workspace

`CapsuleWorkspaceV1` puede transportar archivos de texto adicionales seleccionados explícitamente para revisarlos en la app. El CLI no reconstruye ni repite ese wrapper multiarchivo.

- Si la Capsule anidada funciona por sí sola, extrae y repite esa única fuente.
- Si depende de archivos vecinos, usa `lingua run <directorio-del-proyecto>` sobre el proyecto real.
