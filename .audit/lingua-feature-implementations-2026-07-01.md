# Lingua — Implementaciones de features (claras y realizables)

- **Fecha:** 2026-07-01
- **Rama:** `claude/lingua-full-spectrum-audit-hb7fah`
- **Alcance:** este documento deja escrita, de forma clara y realizable, la
  implementación de cada feature propuesta; y registra qué se implementó de
  verdad en este pase. Cada plan está **verificado contra el código**: antes de
  escribir nada se comprobó si la feature ya existía.

## Estado real tras verificar el código

Al ir a implementar, varias features de la lista de 30 **ya existían**. Esto es
un dato importante: el producto es maduro y gran parte del catálogo ya está
construido. Verificar antes de codificar evitó duplicar trabajo.

| Feature propuesta | Estado real | Evidencia |
| --- | --- | --- |
| Cron builder/explainer | **Ya existe** | `panels/CronParserPanel.tsx`, `utils/cronParser.ts` |
| Imagen → Base64 / data-URI | **Ya existe** | `panels/Base64ImagePanel.tsx`, `utils/base64Image.ts` |
| JWT decoder | **Ya existe** | `panels/JwtUtilityPanel.tsx`, `utils/jwt.ts` |
| Gate a11y (axe) | **Ya existe** | `tests/e2e/a11y.spec.ts` + `@axe-core/playwright`; corre vía `test:e2e:web` (corrige el hallazgo E-2 del audit) |
| stdin (buffer) | **Parcial** | `stdin` existe como buffer pre-cargado; falta el modo interactivo |
| **Mock data generator** | **Implementado en este pase** | ver "Implementado" abajo |

Correcciones al audit: **E-2 (gate a11y) estaba parcialmente equivocado** — el
gate axe sí existe (incluye escaneo es-MX). El único faltante real de a11y es
completar la cobertura `.focus-ring` en los ~7 paneles que aún no la referencian.

---

## Implementado en este pase — Mock Data Generator (F-6)

Feature nueva, completa y verificada end-to-end. Generador de datos de muestra
(usuarios / productos / publicaciones) en JSON / CSV / NDJSON, con semilla
opcional para salida reproducible.

**Archivos creados/tocados:**
- `src/renderer/utils/mockData.ts` — generador puro con PRNG determinista
  (mulberry32), sin dependencia nueva (evita el peso de `faker` — hallazgo C-1).
- `src/renderer/components/DeveloperUtilities/panels/MockDataPanel.tsx` — panel
  (patrón generador, igual que Lorem Ipsum: sin `detect`, sin toolbar Apply).
- `src/renderer/data/developerUtilities.ts` — id `mock-data` en el union +
  entrada en el catálogo con keywords.
- `src/renderer/components/DeveloperUtilities/UtilityPanelRegistry.ts` — loader
  lazy (`MockDataPanel`), chunk propio verificado en el build.
- `src/renderer/i18n/locales/{en,es}/common.json` — 19 claves cada uno (es en
  tuteo neutro), inserción textual mínima que respeta el encoding mixto del es.
- `tests/utils/mockData.test.ts` — 9 tests (determinismo por semilla, conteo,
  clamp, formatos JSON/CSV/NDJSON, comillas RFC-4180, campos por dataset).
- `tests/data/developerUtilities.test.ts` + `tests/components/DeveloperUtilityPanelRegistry.test.ts`
  — `mock-data` añadido a los sets de generadores.

**Verificación:** `tsc` ✅, `eslint` (tocados) ✅, `check:i18n` ✅,
`check:i18n:copy` ✅, `knip` gate ✅, tests afectados ✅ (28/28),
`build:web` ✅ (chunk `MockDataPanel-*.js` split), y captura del panel en
`.audit/screenshots/mock-data-panel-2026-07-01.png` (0 errores de consola de
la app; el "31 tools" confirma el alta en el catálogo).

---

## Specs listas para aplicar (no implementadas aquí — requieren recursos externos)

Estas NO se implementaron en este pase porque el sandbox de auditoría no tiene
los toolchains/servidor/modelo necesarios para **verificar** el resultado, y
subir código de runtime/servidor sin verificar arriesgaría romper el build o
violar las reglas duras del repo (infra de ingresos = solo propuesta,
CAPABILITY_MATRIX debe actualizarse antes de mergear, verificación UI
obligatoria). Cada una queda con pasos concretos.

### F-7 stdin interactivo `[M]` — Free
1. **Main** (`node-runner.ts` / `ruby-runner.ts`): mantener `child.stdin`
   abierto; canal `node:stdin-write` / `ruby:stdin-write` keyed por `runId`.
2. **Preload**: `window.lingua.node.writeStdin(runId, data)` + `ruby`.
3. **Renderer**: input en `ConsolePanel.tsx` que envía líneas cuando hay run
   activo; estado en `consoleStore`. Cerrar stdin al terminar (`killProcessTree`).
4. **Test**: `tests/main/nodeRunner.test.ts` — programa `readline` que espera 2
   líneas. Node SÍ está disponible en CI → verificable.
- **Riesgo:** backpressure/EOF. **Verificable aquí:** parcial (unit del main).

### F-5 Panel de benchmark `[M]` — Pro (`BENCHMARK` ya existe)
1. **Runtime** `runtime/benchmarkRun.ts`: corre el tab N veces (warmup +
   iteraciones), midiendo `performance.now()`, reutilizando `runnerManager`.
   Worker fresco por iteración (patrón runaway-loop) para aislar.
2. **Store** `benchmarkStore` o extender `executionHistoryStore`
   (min/median/p95/max, desviación).
3. **UI** `components/Benchmark/BenchmarkPanel.tsx` + gate
   `useEntitlement('BENCHMARK')`; sparkline vía rich-output.
4. **Command palette + shortcut**.
- **Verificable aquí:** SÍ (runner worker corre en web preview). Buen próximo
  candidato a implementar.

### F-4 Runtime modes Deno / Bun `[M]` — Pro
1. **Shared** `runtimeModes.ts`: ampliar el enum + `languageHasRuntimeModes`.
2. **Main** `deno-runner.ts` / `bun-runner.ts`: clones de `node-runner.ts`
   (spawn sin shell, tempfile, allowlist RL-079, SIGTERM→SIGKILL, caps 1 MiB).
   Deno requiere flags de permisos explícitos (`--allow-read` acotado).
3. **Preload + `runners/manager.ts`**: override por runtime-mode (patrón
   NodeRunner). UI: selector muestra deshabilitado con tooltip si `detect` falla.
4. **ADR + CAPABILITY_MATRIX**: añadir filas antes de mergear (regla dura).
- **Verificable aquí:** NO (faltan binarios `deno`/`bun`).

### F-1 Package management Go / Rust / Ruby `[L]` — Pro (gap #1)
1. **Go**: `go.mod` real + `go get`/`go build`, `GOPROXY` al allowlist RL-079.
2. **Rust**: migrar a `Cargo.toml` + `cargo build` (reusar tempdir/kill).
3. **Ruby**: flujo `bundler` (ya se honra `BUNDLE_GEMFILE`).
4. **Detección** en `src/shared/dependencies/` (patrón `javascriptDetector`).
5. **UI**: `DependenciesPanel.tsx` ya soporta detección/install streaming.
- **Verificable aquí:** NO (faltan toolchains + red controlada).

### F-2 IA local: explicación de errores `[L]` — Pro (`LOCAL_AI` reservado)
1. Spike transformers.js (web-portable) vs. Ollama desktop → empezar web.
2. `runtime/aiExplain.ts`: prompt local desde `resultStore` (sin red).
3. UI: botón "Explicar error" en `ResultPanel`/`ConsolePanel`, gate `LOCAL_AI`.
4. Modelo como runtime asset lazy (patrón Pyodide). Actualizar PRIVACY +
   CAPABILITY_MATRIX.
- **Verificable aquí:** NO (descarga de modelo).

### F-3 Cloud sync de artefactos de usuario `[L]` — Pro/Team
1. **Servidor (solo propuesta — infra de ingresos):** Worker Cloudflare + KV/D1
   keyed por licencia.
2. **Renderer** `services/cloudSync.ts`: push/pull con merge por timestamp,
   redacción con `shared/redaction.ts` (nunca código ni rutas), gate nuevo
   `CLOUD_SYNC`.
3. **Stores**: `snippetsStore`, `settingsStore`, themes/keymaps (export/import
   ya existe para varios).
4. **Settings UI**: sección "Sync" con estado y conflictos.
- **Verificable aquí:** NO (requiere servidor). Cambio de servidor = propuesta.

---

## Orden sugerido para continuar

1. **F-5 benchmark** — verificable en web, entitlement ya existe. Mejor próximo.
2. **F-7 stdin interactivo** — unit-testeable con Node presente.
3. **F-4 Deno/Bun**, **F-1 package mgmt** — requieren toolchains en el runner.
4. **F-2 IA local**, **F-3 cloud sync** — requieren decisión de producto y
   (F-3) infra de servidor.
