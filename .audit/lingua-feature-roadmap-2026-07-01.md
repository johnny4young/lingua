# Lingua — Roadmap de implementación de features (verificado contra el código)

- **Fecha:** 2026-07-01
- **Rama:** `claude/lingua-full-spectrum-audit-hb7fah`
- **Contexto:** continuación de la lista de 30 features. Antes de detallar planes,
  se verificó cada propuesta contra el código real. **Varias ya existían** y se
  descartaron para no duplicar (ver "Ya implementadas"). Este documento detalla
  solo las que faltan de verdad, con slices concretos, archivos a tocar, tests,
  entitlement y riesgo.

## Ya implementadas (descartadas tras verificación)

Estas aparecían en la lista de 30 pero **ya existen** en el código; no requieren
trabajo:

- **Cron builder/explainer** → `src/renderer/components/DeveloperUtilities/panels/CronParserPanel.tsx` + `src/renderer/utils/cronParser.ts`.
- **Imagen → Base64 / data-URI** → `panels/Base64ImagePanel.tsx` + `src/renderer/utils/base64Image.ts`.
- **JWT decoder** (y panel) → `panels/JwtUtilityPanel.tsx` + `src/renderer/utils/jwt.ts` (el lado *encode/firmado* sí puede faltar — ver F-6).
- **SVG → CSS**, **QR**, **diff**, **string inspect**, **number base**, etc. → los 29 paneles ya cubren el grueso de utilidades single-shot.

Lección: el catálogo de utilidades está casi saturado. El valor nuevo está en
**runtimes, sincronización, IA y observabilidad**, no en más paneles pequeños.

---

## Prioridad por impacto/esfuerzo

| # | Feature | Esfuerzo | Impacto | Tier | Estado verificado |
|---|---------|----------|---------|------|-------------------|
| F-1 | Package management Go/Rust/Ruby | L | Alto | Pro | Falta (solo JS/npm + Python micropip existen) |
| F-2 | IA local: explicación de errores | L | Alto | Pro | Falta (entitlement `LOCAL_AI` reservado, sin impl.) |
| F-3 | Cloud sync de artefactos de usuario | L | Alto | Pro/Team | Falta |
| F-4 | Runtime modes Deno / Bun | M | Medio | Pro | Falta |
| F-5 | Panel de benchmark / micro-profiling | M | Medio | Pro | Falta (entitlement `BENCHMARK` existe, sin UI) |
| F-6 | Generador de datos mock / faker | M | Medio | Pro | Falta (dep `faker` ausente) |
| F-7 | stdin interactivo | M | Medio | Free | Falta (stdin es buffer pre-cargado) |
| F-8 | Gate a11y automatizado (axe) | S | Medio | — | Falta (dep `@axe-core/playwright` presente, sin script) |

---

## F-8 `[S]` Gate de accesibilidad automatizado (empezar por aquí)

**Por qué primero:** cierra el hallazgo E-2 del audit, la dependencia ya está
instalada, y no toca runtime.

**Slices:**
1. `tests/e2e/a11y.spec.ts` — Playwright + `@axe-core/playwright` sobre
   `pnpm run preview:web` (puerto 4173). Escanear: shell principal, Command
   Palette abierto, un panel de utilidad, Settings. Gate: 0 violaciones
   `serious`/`critical`.
2. `package.json#scripts` — añadir `check:a11y` y encadenarlo en CI junto a
   `test:e2e:web`.
3. Auditar los paneles restantes contra el requisito `.focus-ring`
   (`src/renderer/README.md:218`) — solo 23 de ~30 lo referencian.

**Tests:** el spec ES el test. **Riesgo:** bajo. **Verificación UI:** obligatoria
(ya corre en navegador).

---

## F-7 `[M]` stdin interactivo

**Estado:** `node-runner.ts` / `ruby-runner.ts` aceptan `stdin` como buffer
único pre-cargado; no hay forma de enviar líneas al proceso vivo.

**Slices:**
1. **Main:** en `node-runner.ts` / `ruby-runner.ts`, mantener el `child.stdin`
   abierto y exponer un canal `node:stdin-write` / `ruby:stdin-write` keyed por
   `runId` (ya existe el `runId` para correlacionar Stop).
2. **Preload:** `window.lingua.node.writeStdin(runId, data)` +
   `ruby.writeStdin` en `src/preload/index.ts`.
3. **Renderer:** input en `ConsolePanel.tsx` que, cuando hay un run activo con
   stdin abierto, envía la línea; store en `consoleStore`.
4. Timeout/limpieza: cerrar stdin al terminar el run (ya hay `killProcessTree`).

**Tests:** `tests/main/nodeRunner.test.ts` — programa que hace `readline` y
espera dos líneas; assert que la salida refleja ambas. **Riesgo:** medio (manejo
de backpressure/EOF). **Entitlement:** ninguno (Free). **Web:** no aplica
(desktop-only, degradar honestamente).

---

## F-5 `[M]` Panel de benchmark / micro-profiling

**Estado:** el entitlement `BENCHMARK` ya está en
`src/shared/entitlements.ts:25`, pero no hay UI ni runtime que lo consuma.

**Slices:**
1. **Runtime:** `src/renderer/runtime/benchmarkRun.ts` — corre el tab activo N
   veces (warmup + iteraciones), midiendo `performance.now()` por corrida,
   reutilizando `executeTabManually`/`runnerManager`.
2. **Store:** extender `executionHistoryStore` o crear `benchmarkStore` con
   resultados (min/median/p95/max, desviación).
3. **UI:** `components/Benchmark/BenchmarkPanel.tsx` — tabla + sparkline
   (reutilizar el sistema de rich-output). Gate con
   `useEntitlement('BENCHMARK')`.
4. **Command palette + shortcut** en `commandPaletteModel.ts` y
   `data/keyboardShortcuts.ts`.

**Tests:** `benchmarkRun` puro con clock inyectado; component test del gate
Pro/Free. **Riesgo:** medio (aislar efectos entre corridas — usar worker
fresco por iteración como ya hace el runaway-loop pattern). **i18n:** claves
`benchmark.*` en ambos locales. **Verificación UI:** obligatoria.

---

## F-4 `[M]` Runtime modes Deno / Bun para JS/TS

**Estado:** `RUNTIME_MODES_ADR.md` ya define el registro `runtimeMode`
(`worker` / `node` / `browser-preview`); añadir `deno` y `bun` es aditivo.

**Slices:**
1. **Shared:** ampliar el enum en `src/shared/runtimeModes.ts` +
   `languageHasRuntimeModes`.
2. **Main:** `src/main/deno-runner.ts` / `bun-runner.ts` — clones de
   `node-runner.ts` (spawn sin shell, tempfile, env allowlist RL-079,
   SIGTERM→SIGKILL, caps 1 MiB). Deno necesita flags de permisos explícitos
   (`--allow-read` scope) — decisión de seguridad a documentar.
3. **Preload + registry:** exponer `window.lingua.deno/bun.{detect,run,stop}` y
   registrar el override en `runners/manager.ts` (patrón NodeRunner).
4. **UI:** el `RuntimeModeSelector.tsx` los muestra deshabilitados con tooltip
   "requiere Deno/Bun instalado" cuando `detect` falla (patrón ya existente).

**Tests:** `nativeEnv` allowlist para Deno/Bun; detect missing-binary path.
**Riesgo:** medio (modelo de permisos de Deno). **Entitlement:** Pro
(consistente con Go/Rust). **CAPABILITY_MATRIX + ADR:** añadir filas antes de
mergear (regla dura del repo).

---

## F-6 `[M]` Generador de datos mock (faker)

**Slices (patrón adapter, verificado en `src/shared/utilities/registry.ts`):**
1. Añadir dep ligera (`@faker-js/faker` o un generador propio mínimo para
   evitar el peso — decidir según budget de bundle; el audit ya marcó C-1).
2. `src/shared/utilities/mockData.ts` — adapter con opciones (schema simple:
   `name/email/uuid/date/number/lorem`, count).
3. Registrar id en `types.ts` (`UTILITY_ADAPTER_IDS`) + `registry.ts`.
4. Panel `panels/MockDataPanel.tsx` + entrada en `data/developerUtilities.ts`.
5. i18n: `utilityPipeline.adapter.mock-data.*` en ambos locales.

**Tests:** adapter puro (determinismo con seed). **Riesgo:** bajo-medio
(vigilar peso de bundle — preferir generador propio o import dinámico).
**Entitlement:** encaja como workflow multi-paso → `DEV_UTILITIES` (Pro) para
pipelines; single-shot puede quedar Free. **Verificación UI:** obligatoria.

---

## F-3 `[L]` Cloud sync opcional de artefactos de usuario

**Estado:** no existe; upsell natural Pro/Team. Debe sincronizar SOLO artefactos
del usuario (snippets, settings, themes, keymaps) a través del redactor
existente — **nunca código ni rutas** (`src/shared/redaction.ts`).

**Slices:**
1. **Servidor (propuesta, no aplicar sin revisión — infra de ingresos):**
   endpoint en Cloudflare Worker + KV/D1 keyed por licencia; reutiliza el
   patrón de `license-server`.
2. **Renderer service:** `services/cloudSync.ts` — push/pull con merge por
   timestamp, gate `useEntitlement` (nuevo `CLOUD_SYNC` o reusar tier).
3. **Stores afectados:** `snippetsStore`, `settingsStore`, `themes` — exponer
   export/import serializable (ya existe para themes/keymaps).
4. **Settings UI:** sección "Sync" con estado y conflictos.

**Tests:** merge determinista; redacción aplicada antes del POST. **Riesgo:**
alto (privacidad + conflictos). **Regla dura:** el cambio de servidor es
**propuesta**, no aplicación directa. **Requiere decisión de producto**
(entitlement nuevo).

---

## F-2 `[L]` IA local: explicación de errores

**Estado:** entitlement `LOCAL_AI` reservado (`entitlements.ts:21`), spike
RL-031 pendiente en el matrix. Primer win barato: explicar el `stderr` de un run
fallido con un modelo pequeño en el navegador.

**Slices:**
1. **Spike/decisión:** transformers.js (WASM, web-portable) vs. Ollama desktop
   (modelos grandes). Empezar con transformers.js para paridad web/desktop.
2. **Runtime:** `runtime/aiExplain.ts` — toma el resultado del runner
   (`resultStore`), arma un prompt local (sin red) y devuelve explicación.
3. **UI:** botón "Explicar error" en `ResultPanel.tsx`/`ConsolePanel.tsx`, gate
   `useEntitlement('LOCAL_AI')`.
4. **Privacidad:** todo local; documentar en `PRIVACY.md` que no sale nada.
   Modelo como runtime asset lazy (patrón Pyodide/DuckDB).

**Tests:** prompt builder puro; gate Pro/Free. **Riesgo:** alto (peso del
modelo, latencia — lazy + budget). **Actualizar CAPABILITY_MATRIX** (fila Local
AI inference, hoy "Research").

---

## F-1 `[L]` Package management Go / Rust / Ruby

**Estado:** hoy solo JS/TS (npm desktop) + Python (micropip web) tienen install;
Go/Rust/Ruby marcan `packages: desktop-only` sin flujo real. Es el gap #1 vs.
competidores ("no corre mi snippet real").

**Slices (extienden la lane RL-025, `src/main/dependencies.ts` + `ipc/dependencies.ts`):**
1. **Go modules:** en `go-compiler.ts`, generar `go.mod` real y correr
   `go get`/`go build` con `GOPROXY` añadido al allowlist RL-079 (hoy excluido a
   propósito). Detección de imports desde el source (patrón `javascriptDetector`).
2. **Rust crates:** migrar de `rustc` suelto a `Cargo.toml` temporal + `cargo
   build`, reutilizando tempdir/kill de `rust-compiler.ts`.
3. **Ruby gems:** flujo `bundler` (ya se honra `BUNDLE_GEMFILE` en
   `ruby-runner.ts`); marcar la lane RL-025 correspondiente.
4. **Detección compartida:** adapters en `src/shared/dependencies/` (existe
   `javascriptDetector`/`pythonDetector`) → `goDetector`, `rustDetector`,
   `rubyDetector`.
5. **UI:** el `DependenciesPanel.tsx` ya soporta detección/install streaming;
   añadir los tres lenguajes.

**Tests:** detectores puros + install spawn (shell:false) con timeout/cancel.
**Riesgo:** alto (red saliente controlada, cache, offline). **Entitlement:** Pro
(Go/Rust ya lo son). **Seguridad:** ampliar el allowlist de env con cuidado
(`GOPROXY`/`CARGO_HOME`) — documentar cada clave nueva (patrón `nativeEnv.ts`).

---

## Orden de ejecución sugerido

1. **F-8** (a11y gate) — cierra deuda del audit, sin riesgo.
2. **F-7** (stdin interactivo) — desbloquea muchos snippets reales, Free.
3. **F-5** (benchmark) — entitlement ya existe, valor Pro claro.
4. **F-6** (mock data) — panel aditivo de bajo riesgo.
5. **F-4** (Deno/Bun) — aditivo sobre el registro de runtime modes.
6. **F-1** (package management) — el gap más grande, mayor esfuerzo.
7. **F-2 / F-3** (IA local, cloud sync) — requieren decisión de producto y
   (F-3) cambios de servidor que son propuesta, no aplicación directa.
