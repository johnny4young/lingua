# Revisión profunda de Lingua — julio 2026

> Auditoría integral del proyecto en cinco dimensiones (seguridad,
> bugs, rendimiento, arquitectura/mantenibilidad y estrategia de
> producto), con las correcciones aplicadas en este mismo cambio y un
> roadmap priorizado hacia un producto de talla mundial.
>
> Alcance revisado: `src/main` (completo), `src/renderer/stores`
> (completo), runtimes de notebooks/runners, `src/shared`, la capa
> IPC/preload, el sistema de licencias (cliente + worker Cloudflare),
> el updater y las superficies HTML/iframe del renderer. La suite tiene
> ~6150 pruebas unitarias + ~45 specs Playwright; `tsc`, `eslint`,
> `vitest`, `check:i18n` pasan en verde tras los cambios.

## Resumen ejecutivo

La ingeniería de Lingua ya está **muy por encima de su peso**: sandbox
de sistema de archivos por capacidades, verificación de licencias
Ed25519 offline, iframes con sandbox estricto y CSP por modo de
runtime, runners nativos sin shell con terminación por árbol de
procesos, migraciones de stores versionadas, gate de accesibilidad
WCAG 2.1 AA automatizado y una disciplina de ADRs + tests anti-drift
poco habitual en un proyecto de este tamaño.

Lo que separa a Lingua de un producto de talla mundial no es la
calidad del código, sino cuatro frentes de **producto**: (a) ausencia
total de IA, (b) profundidad de Python (pip real + debugger), (c) un
free tier demasiado restrictivo para enamorar (1 pestaña), y (d) solo
dos idiomas. Todo lo demás es ejecución sobre cimientos que ya existen.

Esta revisión encontró **1 hallazgo de seguridad de severidad media**
(más 4 menores), **2 bugs críticos** y **~14 bugs adicionales**, y **2
cuellos de botella de rendimiento de alto impacto**. Las correcciones
seguras y verificables se implementaron en este cambio; el resto queda
documentado como trabajo priorizado.

---

## 1. Seguridad

### Postura general: sólida

Buenas prácticas verificadas y dignas de reconocimiento:

- **`webPreferences` endurecido**: `contextIsolation:true`,
  `nodeIntegration:false`, `sandbox:true`, `webSecurity:true` fijados
  explícitamente (`src/main/index.ts`).
- **Navegación bloqueada**: `setWindowOpenHandler → deny`,
  `will-attach-webview` prevenido, `will-navigate` **y**
  `will-redirect` filtrados con allowlist de origen.
- **Sandbox de FS por capacidades (RL-077)**: `rootId` opaco, rechazo
  de `..`/rutas absolutas/prefijos de dispositivo Windows, doble
  verificación con `realpath` anti-symlink, denylist defensiva.
- **Preload mínimo y tipado**: solo pasa mensajes; toda la autoridad
  vive en main. `fs:delete` exige confirmación nativa.
- **Verificación de licencia correcta**: Ed25519 vía WebCrypto, firma
  verificada **antes** de decisiones de ventana temporal; el worker
  usa comparación en tiempo constante para el HMAC de webhooks con
  ventana anti-replay de ±5 min.
- **Runners sin shell**: `spawn`/`execFile` con argv fijo, `mkdtemp`
  anti-colisión, env allowlisted, timeouts con escalada
  SIGTERM→SIGKILL por árbol de procesos, caps de salida de 1 MiB.
- **Iframes de preview con sandbox estricto**: `sandbox="allow-scripts"`
  sin `allow-same-origin`, CSP `default-src 'none'`, `srcDoc`,
  `referrerpolicy="no-referrer"`, validación de `postMessage` por
  discriminador + `runId`.
- **Sin `dangerouslySetInnerHTML`/`eval`/`new Function`** en el
  renderer; markdown sanitizado con DOMPurify.
- **Dependencias al día**: Electron 42, React 19, Vite 8, wrangler 4.

### Hallazgos

| # | Sev. | Área | Estado |
|---|------|------|--------|
| S1 | Media | La capa Git de solo lectura evadía la contención del sandbox de FS | ✅ Corregido |
| S2 | Baja | La URL del license-server no forzaba HTTPS | ✅ Corregido |
| S3 | Baja | CSP del renderer permite `unsafe-inline`/`unsafe-eval` | 📋 Documentado |
| S4 | Info | El feed darwin del update-server sin checksum de integridad | 📋 Documentado |
| S5 | Baja | `userEnv` podía fijar `LD_PRELOAD`/`NODE_OPTIONS` en runners nativos | ✅ Corregido |

**S1 — Git read-only evadía la contención de capacidades (corregido).**
`isApprovedGitScope` solo aplicaba la denylist y la intersección de
scope al `repoRoot`, nunca al `filePath` individual. Como el brazo
"ancestro" de `pathIntersectsApprovedScope` acepta un `repoRoot` que
sea padre de un proyecto aprobado (caso monorepo), un renderer
comprometido podía llamar `git.diff('repo', 'repo/.env')` o
`git.diff('repo', 'repo/otra-app/secrets.json')` y leer hasta 64 KiB de
archivos **fuera** del scope aprobado, incluyendo secretos no
versionados.
*Fix:* nuevo gate `isApprovedGitFile` en `src/main/ipc/git.ts` que
resuelve la ruta absoluta del archivo y exige (a) que no esté en la
denylist y (b) que esté **dentro** del scope aprobado
(`pathInsideApprovedScope`, variante sin el brazo "ancestro", añadida a
`src/main/ipc/fileSystem.ts`). Cubierto con 4 tests nuevos en
`tests/ipc/gitHandlers.test.ts`.

**S2 — HTTPS obligatorio en el license-server (corregido).**
`getBaseUrl` solo hacía `trim()`; un build mal configurado con
`http://` enviaría el token Bearer en claro (el CSP del renderer no
aplica al `fetch` de main). *Fix:* `isAllowedLicenseServerUrl` rechaza
todo esquema que no sea `https:`, salvo loopback para desarrollo.

**S5 — Denylist de claves de inyección de loader (corregido).**
`buildNativeRunnerEnv` fusionaba el env del usuario sin filtrar
`LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS`, etc. No es un
límite de privilegio (ejecutar runners nativos ya es código arbitrario
por diseño), pero un renderer comprometido no debería obtener un
primitivo de inyección de loader sobre cada binario spawneado. *Fix:*
`USER_ENV_DENYLIST` en `src/main/runners/nativeEnv.ts`; `PATH` sigue
permitido (necesidad legítima).

**S3 — CSP con `unsafe-inline`/`unsafe-eval` (documentado).**
`unsafe-eval` es necesario para Pyodide/WASM; `unsafe-inline` sostiene
el bootstrap de tema. Riesgo residual acotado por `default-src 'self'`
+ aislamiento. Mejora futura: mover el bootstrap a un archivo con hash
y sustituir `unsafe-inline` por `'sha256-...'`.

**S4 — Feed darwin sin checksum (documentado/informativo).** La
respuesta estilo Squirrel.Mac entrega `url` sin `sha512`; la integridad
depende de HTTPS + firma de código del SO. El canal productivo real usa
el proveedor GitHub de electron-updater (cuyo `latest-mac.yml` sí lleva
sha512), por lo que el servidor custom puede ser un canal separado —
conviene confirmar cuál es el canal activo o añadir el hash.

---

## 2. Bugs

| # | Sev. | Descripción | Estado |
|---|------|-------------|--------|
| B1 | Crítica | Re-ejecutar una celda de notebook JS/TS lanzaba `Identifier already declared` | ✅ Corregido |
| B2 | Crítica | `fs:watch-start` sin listener `'error'` → crash del proceso main | ✅ Corregido |
| B3 | Alta | `restart()` del LSP generaba un proceso servidor duplicado y huérfano | ✅ Corregido |
| B4 | Alta | Cancel/timeout de `npm install` mataba solo `npm`, no su árbol | ✅ Corregido |
| B5 | Alta | Windows: spawn de `npm` (sin `.cmd`) fallaba siempre | 📋 Documentado |
| B6 | Alta | Revalidación web de licencia revivía una licencia recién eliminada | ✅ Corregido |
| B7 | Alta | `saveTabById` descartaba teclas escritas durante un guardado en vuelo | ✅ Corregido |
| B8 | Alta | "Replace all" leía query/replacement vivos mientras los inputs seguían editables | ✅ Corregido |
| B9 | Alta | `git:watch-head` filtraba un `fs.watch` bajo doble llamada | ✅ Corregido |
| B10 | Baja | `disposeProcess()` del LSP generaba una unhandled rejection en cada stop | ✅ Corregido |
| B11 | Media | `openFile`: doble clic abría el mismo archivo dos veces | ✅ Corregido |
| B12 | Media | Opens concurrentes filtraban watcher/capability; `watchStop` sin `.catch()` abortaba el open | ✅ Corregido |
| B13 | Media | `applyWatchChanges` commiteaba un árbol derivado de snapshot stale | 📋 Documentado |
| B14 | Media | Watchers del bridge fs no atados al ciclo de vida del sender (fuga en macOS/reload) | ✅ Corregido |
| B15 | Media | Runners Node/Ruby: temp dir creado fuera de región protegida → fuga + rechazo crudo | ✅ Corregido |
| B16 | Media | Cierre "sucio" sin fallback para renderer muerto → ventana imposible de cerrar | ✅ Corregido |

**B1 — Notebook: re-run rompía con `Identifier already declared`
(corregido).** El paso de pull-in inyectaba `const KEY = <JSON>;` por
cada clave del sandbox en el **mismo bloque** donde se pega el código
del usuario, sin excluir las claves que la celda re-declara. Segundo
`Run` de `let x = 1` (con `x` ya en el sandbox) → `SyntaxError`. Lo
sufría cualquier usuario de notebooks al segundo clic. *Fix:*
`collectTopLevelDeclaredNames` (AST TypeScript) excluye los
identificadores top-level que la celda declara antes de emitir
pull-ins. 3 tests de regresión en `notebookSession.test.ts`.

**B2 — `fs:watch-start` crasheaba main (corregido).** El try/catch solo
cubría fallos síncronos de registro; un `FSWatcher` emite `'error'`
asíncrono (EPERM en Windows al borrar la carpeta vigilada,
ENOSPC/EMFILE diferidos) que sin listener se vuelve excepción no
capturada. *Fix:* `watcher.on('error', ...)` que cierra, deregistra y
emite `fs:watcher-failed`, replicando la postura del watcher de git.

**B3 — LSP restart duplicaba el servidor (corregido).** `restart()`
mata al hijo y agenda un nuevo `start()`; el evento `exit` del hijo
muerto entraba a `handleExit()` y agendaba una recuperación que
sobrescribía `this.process`, dejando el primer proceso vivo e
inalcanzable (diagnósticos duplicados, lock del workspace retenido).
*Fix:* `onExit` ignora salidas de procesos que ya no son `this.process`
(guardia `if (this.process !== lsp) return`). Aplicado a rust-analyzer
y gopls.

**B4 — `npm install` dejaba árboles huérfanos (corregido).** El
instalador usaba `child.kill()` plano; SIGKILL a npm no alcanza
`node-gyp`/postinstall. *Fix:* `detachedSpawnOptions()` +
`killProcessTree()`, el mismo patrón que ya usan todos los runners
nativos.

**B6 — Revalidación web revivía licencia eliminada (corregido).**
`revalidate()` capturaba el token antes de varios awaits y hacía `set()`
incondicional; un "Remove license" en vuelo se revertía solo, y el
listener cross-tab lo resucitaba porque persist v5 no sincroniza estado
en memoria entre pestañas. *Fix:* helper `commit()` que aborta si
`get().token` cambió respecto al inicio (equivalente web de la barrera
`bootstrapApplied` del desktop) + `persist.rehydrate()` en el listener
`storage`.

**B7 — Save descartaba trabajo (corregido).** `saveTabById`
reemplazaba el tab entero con el snapshot pre-guardado; teclas escritas
durante `formatOnSave` + write se perdían con `isDirty:false`. *Fix:*
si el contenido cambió durante el guardado, se conserva el texto nuevo
como dirty y solo se adopta path/rootId/language del resultado.

**B8 — "Replace all" con query vivo (corregido).** `applyToFile` leía
`query`/`replacement` de `get()` por archivo; escribir la siguiente
búsqueda mientras drenaba la cola aplicaba un query a medio escribir a
los archivos restantes (operación no-deshacible). *Fix:* `applyToAll`
congela los params confirmados y los pasa a cada `applyToFile`.

**B5 — npm en Windows (documentado).** `spawn('npm', ...)` sin resolver
`npm.cmd` y con `shell:false` falla siempre en win32
(CVE-2024-27980 → `EINVAL`). Requiere validación en una máquina Windows
real; el fix propuesto es resolver la ruta de `npm.cmd` o invocar vía
`cmd.exe /c` con argv fijo. No se aplicó aquí por no poder verificarlo
end-to-end en este entorno.

**B14 — Fuga de watchers fs por sender (corregido).** Los watchers del
bridge fs solo se limpiaban en `before-quit` y en `fs:watch-stop`
explícito; al cerrar la ventana en macOS (la app sigue viva) o al
recargar el renderer, el watcher recursivo del proyecto quedaba vivo y
un `rootId` nuevo nunca deduplicaba contra el viejo. *Fix:* registro por
sender (`watcherIdsBySender`) + listener `destroyed` idempotente que
llama `stopWatchersForSender`, exactamente el patrón del watcher de git.
2 tests nuevos en `watcherLifecycle.test.ts`.

**B13 — Snapshot stale del árbol (documentado).** Mejora de robustez en
`projectStore` (commit por directorio sobre estado fresco); se deja
documentado con el fix propuesto para un slice dedicado con su propia
cobertura de tests.

---

## 3. Rendimiento

### Lo que ya se hace bien

Infraestructura de presupuestos (`performance:report` /
`check:performance` / `baseline.json` con gate en CI); lazy loading de
CodeEditor, Notebook, SQL/HTTP/Utilities y del registro Monaco por
lenguaje; workers WASM persistentes (Pyodide/Ruby/DuckDB singletons);
memoria acotada (ring de historial, LRU de cápsulas, virtualización de
Console/Notebook, barrido de modelos Monaco al cerrar tabs); main sin
`execSync`/`spawnSync` y con detección cacheada de Node/Ruby/Git.

### Hallazgos y correcciones

| # | Impacto | Descripción | Estado |
|---|---------|-------------|--------|
| P1 | Alto | Monaco (~987 KB gzip) se ejecutaba en el arranque del shell por dos aristas estáticas | ✅ Corregido |
| P2 | Alto | Todo el shell (`AppChrome`) re-renderizaba en cada pulsación | ✅ Corregido |
| P3 | Medio | `EditorTabs` re-renderizaba la tira completa por keystroke | 📋 Documentado |
| P4 | Medio | Los dos locales i18n viajan en el chunk inicial | 📋 Documentado |
| P5 | Medio | Detección Go/Rust sin caché → 1-2 spawns extra por run | ✅ Corregido |
| P6 | Medio | fs síncrono en hot paths de ejecución (node/ruby/deps) | 📋 Documentado |
| P7 | Medio-bajo | Pipeline de utilities y diff Myers en el hilo de UI | 📋 Documentado |
| P8 | Bajo | Suscripciones a store completo (`useUIStore()` en AppChrome) | ✅ Corregido (parcial) |

**P1 — Monaco fuera del arranque del shell (corregido).** Dos aristas
estáticas forzaban la **ejecución** del chunk completo de Monaco
(~3.8 MB / ~987 KB gzip) como parte del boot del shell: el
`import * as monacoNs` en `useLspLifecycle.ts` (montado en `AppChrome`
en web aunque el LSP sea desktop-only) y el `import { DiffEditor }` de
`GitDiffPanel` vía `BottomPanel`. *Fix:* (a) `useLspLifecycle` importa
Monaco dinámicamente dentro del efecto de diagnostics (mismo patrón que
`useDocumentSymbols`); (b) `GitDiffPanel` se carga con `React.lazy` en
`BottomPanel`. Nota de honestidad: Monaco sigue en `modulepreload`
(se descarga en paralelo porque el editor lo necesita igual, y otros
consumidores —`CodeEditor`, `monaco.ts`— lo importan estáticamente),
pero ya no se **ejecuta** antes de que el shell pinte ni en superficies
web sin editor. Sacar Monaco por completo del grafo estático exigiría
diferir también `monaco.ts` desde `useInlineLint`/`useDocumentSymbols`,
un slice aparte.

**P2 — Shell sin re-render por keystroke (corregido).** `updateContent`
crea un array `tabs` nuevo por tecla; hooks montados en `AppChrome`
(`useLspLifecycle`, `useGitStatus`, `useDependencyDetection`,
`useAutoRun`) se suscribían a `state.tabs` o al objeto de tab activo,
re-renderizando toda la shell (~3-10 ms/tecla). *Fix:* `useLspLifecycle`
y `useGitStatus` pliegan a primitivos dentro del selector y leen la
lista viva imperativamente vía `getState()`; `useAutoRun` y
`useDependencyDetection` se aíslan en un componente hoja
`KeystrokeReactiveHooks` que no renderiza nada, sacando su churn
inevitable fuera de `AppChrome`; `App.tsx` selecciona
`toggleSidebar`/`toggleConsole` individualmente en lugar de
`useUIStore()` completo.

**P5 — Caché de toolchain Go/Rust (corregido).** `detectGo`/`detectRust`
se llamaban en cada run sin caché (~40-160 ms de spawns fijos). *Fix:*
caché de sesión para el probe de env por defecto, con la misma
convención que `detectNode` (solo cachea detects exitosos, así instalar
la toolchain a mitad de sesión se detecta en el siguiente run).

**P3/P4/P6/P7 (documentados).** Pendientes de slices dedicados:
`EditorTabs` con selector `useShallow` a primitivos + `memo` en el item;
locale inactivo con `import()` diferido; migrar los probes síncronos de
`node-runner`/`ruby-runner`/`dependencies` a `fs/promises`; mover
`runUtilityPipeline` y `computeDiff` a un worker con Comlink. Ninguno
bloquea; todos tienen patrón de fix ya presente en el repo.

---

## 4. Arquitectura y mantenibilidad

### Fortalezas

Fronteras de proceso limpias (`shared/` sin electron/renderer, main sin
renderer, contrato `window.lingua` idéntico desktop/web); disciplina
anti-drift mecanizada (matriz de capacidades auto-derivada, tests de
docs, drift-guard de migraciones, gate de tipos brandeados); stores
descompuestas con fachadas delgadas + action-factories; testing en
capas (unit + e2e + perf + smoke empaquetado).

### Hallazgos

| # | Leverage | Descripción | Estado |
|---|----------|-------------|--------|
| A1 | Alto | Contrato IPC "stringly-typed" duplicado en 4 archivos | 📋 Documentado |
| A2 | Alto | Sprawl de configs de build; la mina de env vars es síntoma estructural | 📋 Documentado |
| A3 | Alto | Stores importaban de `hooks/` y `components/` (ciclo latente) | ✅ Corregido |
| A4 | Medio | Ciclo de vida de spawn duplicado 4 veces en los runners nativos | 📋 Documentado |
| A5 | Medio | 10 componentes de 800+ líneas violan la regla propia de 250-300 | 📋 Documentado |
| A6 | Medio | `notebookStore` (958 líneas) es la única "god store" restante | 📋 Documentado |
| A7 | Medio | Árbol de tests con espejos inconsistentes + huecos de cobertura | 📋 Documentado |
| A8 | Bajo | `ARCHITECTURE.md` se contradecía sobre el watch flow (pre-RL-146) | ✅ Corregido |

**A3 — Congelado el ciclo latente stores → hooks/components
(corregido).** 8+ stores importaban `currentEffectiveTier` desde
`../hooks/useEntitlement`, y `settingsAppearanceActions` importaba
`isDarkEditorTheme` desde `components/Settings/` — un anillo
stores→hooks→stores que hoy no es un ciclo de módulos pero rompería el
orden de init de Zustand en runtime el día que `useEntitlement` toque
una store de editor. *Fix:* `currentEffectiveTier`/`tierFromStatus`
movidos a `stores/licenseSelectors.ts` (re-exportados desde
`useEntitlement`); catálogo de temas movido a
`utils/editorThemeCatalog.ts` (re-exportado desde `settingsOptions`).
**Congelado con reglas `no-restricted-imports`**: `stores/**` no puede
importar de `hooks/**` ni `components/**`; `shared/**` no puede importar
`electron`/`react`/`zustand` ni de `renderer`/`main`.

**A8 — `ARCHITECTURE.md` corregido.** Las secciones "Desktop watch
flow" y "Why watch events trigger a full refresh" describían el diseño
pre-RL-146 (`refreshTree()` root-granular), contradiciendo el código
real (`applyWatchChanges` incremental). Reescritas como "historia +
estado actual".

**A1/A2/A4/A5/A6/A7 (documentados, ver §6).** Son refactors de
mediana/alta envergadura que merecen slices propios; se detallan como
recomendaciones priorizadas más abajo.

---

## 5. Comparativa de producto

| Competidor | Dónde gana Lingua | Dónde pierde |
|---|---|---|
| **RunJS** | Multi-lenguaje real, utilidades, notebooks, HTTP/SQL, web gratis | Instalación npm sin fricción; marca establecida |
| **Replit** | Offline, privacidad, sin cuenta, latencia cero | Colaboración, hosting/deploy, IA, mobile |
| **CodeSandbox/StackBlitz** | Python/Go/Rust locales, no depende de la nube | Node+npm completo en el navegador (WebContainers) |
| **Jupyter** | Cero setup, multi-lenguaje, DuckDB integrado | pip/conda reales, widgets, ecosistema científico |
| **Zed/Cursor** | Runner con feedback inline, utilidades, capsules | **IA** (table stakes en 2026) |

**Síntesis:** hoy Lingua es el mejor *scratchpad multi-lenguaje offline
y privado* del mercado. Pierde en tres frentes: IA (contra todos),
npm-en-navegador (contra StackBlitz), y profundidad Python (contra
Jupyter).

---

## 6. Roadmap hacia "talla mundial"

### Top 10 funcionalidades priorizadas

1. **IA local/híbrida (RL-031) — impacto máximo.** "Explica este
   error", "arregla este snippet", autocompletado. Clase híbrida:
   transformers.js/webllm en browser WASM para paridad web, Ollama/
   llama.cpp desktop nativo, más modo BYO-API-key. Coherente con la
   marca de privacidad; el entitlement `LOCAL_AI` ya está reservado y
   es la feature Pro más vendible.
2. **Debugger de Python (RL-027 Slice 2) — ya diseñado.** Puente `pdb`
   headless por IPC, desktop nativo. Python es el lenguaje free más
   usado; un debugger solo-JS/TS debilita la promesa multi-lenguaje.
3. **CPython nativo + pip/venv en desktop.** Mismo patrón que el Node
   runner (spawn sin shell, allowlist de env, SIGTERM→SIGKILL).
   Desbloquea pandas/numpy/requests reales; separa a Lingua de "juguete
   Python".
4. **Celdas SQL y JS en notebooks — esfuerzo bajo.** El runtime
   DuckDB-WASM y el worker JS ya existen; falta cablearlos al modelo de
   celdas.
5. **Git de escritura (stage/commit/branch) — ya planificado.** Desktop
   nativo sobre el `execFile` sandboxeado existente.
6. **Modo WebContainer para Node en web — impacto alto, riesgo de
   licencia.** Cerraría la brecha contra StackBlitz; evaluar costo de
   licencia antes de comprometer.
7. **Autocompilación remota de Go/Rust para web (Pro).** Convierte el
   stub web en feature Pro; requiere una fila nueva ("remoto") en la
   matriz de capacidades.
8. **Auto-instalación npm sin `package.json` previo.** Genera un
   `package.json` efímero para tabs no guardadas; elimina fricción letal
   frente a RunJS.
9. **Sync E2E de snippets/capsules/settings (Pro/Team).** Primer motivo
   de suscripción recurrente; las capsules ya son un formato portable
   validado. Rompe el "no-backend" — hacerlo opt-in y cifrado.
10. **Benchmark/test runner inline.** El entitlement `BENCHMARK` ya
    existe sin feature detrás; micro-benchmarks en el worker JS +
    `go test`/`cargo test` vía los runners desktop.

### Refactors estructurales priorizados

| # | Acción | Esfuerzo | Retorno |
|---|--------|----------|---------|
| A1 | Contrato IPC tipado con canales como fuente única (`src/shared/ipcContract.ts`) | M | Elimina el drift silencioso preload↔main |
| A2 | Helper único de env + test de drift de configs; retirar el residuo de Forge | S+M | Desactiva la mina documentada en CLAUDE.md |
| A4 | `spawnNativeRun` + `detectToolchain` compartidos | M | −600/800 líneas; el 5º runner cuesta un tercio |
| A5 | Split oportunista de los 10 componentes 800+ (empezar por NotebookView, EditorSection) | S-M c/u | Diffs revisables |
| A6 | Descomponer `notebookStore` con el patrón RL-128 | M | Cierra la última "god store" |
| A7 | Unificar árbol de tests espejo + cubrir bridges de debugger/preview y workers go/ruby | S+M | Cierra huecos reales de cobertura |

### Brechas de calidad transversales

- **Onboarding:** hay tour + recetas + Welcome; falta un playground
  precargado por lenguaje al primer arranque y medición del funnel de
  activación (el pipeline de telemetría ya existe — úsalo para
  time-to-first-run).
- **Accesibilidad:** de las más serias en un indie (gate axe en CI,
  flujos solo-teclado). Deudas reconocidas: regla `color-contrast`
  silenciada por el bug oklch de axe, comentarios bajo AA sin tema de
  alto contraste. Acción: theme pack de alto contraste + revisar el
  silencio de axe periódicamente.
- **i18n:** solo en/es; el tooling hace barato añadir locales. Para
  talla mundial: pt-BR (mercado educativo enorme), ja, zh-CN, de/fr.
- **Distribución:** 0.9.0 ya firma/notariza en las tres plataformas.
  Pendientes: canal beta real y presencia en gestores de paquetes
  (Homebrew cask, winget, Flathub) — para devs, eso ES distribución.
- **Documentación de usuario:** `USAGE.md` es delgada frente a la
  superficie real (capsules, pipelines, notebooks, HTTP/SQL, debugger).
  Falta docs buscable en la app o F1 contextual.

### Modelo de negocio

El **`maxOpenTabs: 1` del free tier es un freno de adopción, no un motor
de conversión.** Un runner multi-lenguaje con una sola pestaña no deja
experimentar el producto (comparar dos snippets, JS + su CSS para
preview requiere pestañas hermanas). Recomendación: subir el free tier a
5-10 pestañas / 25 snippets e **incluir Go y Rust en free** (su gate
actual es incoherente: exigen la toolchain del propio usuario, costo
marginal cero, y son el titular del README). Cobrar por la *profundidad*
(debugger, LSP premium, packages, IA, sync), no por el *acceso*.
Mantener Education gratuito y agresivo — profesores = distribución.

### Riesgos estratégicos

1. **Mantenimiento de runtimes WASM** (Pyodide, Ruby WASM, DuckDB,
   esbuild): cuatro cadenas con cadencias propias; Fengari pinneado y
   sin mantenimiento. Mitigación: smoke por runtime en CI + presupuesto
   trimestral de bumps.
2. **Tamaño de binario/descarga:** cada runtime nuevo (CPython nativo,
   modelos IA) multiplica el instalador. Definir presupuesto duro +
   descarga diferida de runtimes.
3. **Ventana competitiva de IA:** cada mes sin RL-031, la categoría se
   redefine sin Lingua.
4. **Bus factor / sobre-extensión de superficie:** un mantenedor, 7
   runtimes, 29 utilidades, notebooks, HTTP, SQL, debugger, CLI, dos
   servidores. La disciplina de ADRs mitiga; priorizar profundidad
   sobre amplitud.
5. **Dependencia de Cloudflare + GitHub Releases** para todo el canal de
   distribución: un solo proveedor de fallo. Falta plan de contingencia.

---

## Apéndice — Cambios aplicados en este PR

**Seguridad:** S1 (git file-scope gate), S2 (HTTPS license-server), S5
(denylist de loader env).

**Bugs:** B1 (notebook re-run), B2 (fs watcher error), B3 (LSP restart
×2 launchers), B4 (npm process tree), B6 (revalidate race + cross-tab),
B7 (save race), B8 (replace-all frozen params), B9 (git watch-head
race), B10 (LSP shutdown rejection ×2), B11 (openFile double-open), B12
(project open best-effort retirement), B14 (fs watcher sender
lifecycle), B15 (temp-dir leak node/ruby), B16 (render-process-gone
force-close).

**Rendimiento:** P1 (Monaco lazy ×2 aristas), P2 (shell re-render),
P5 (caché Go/Rust), P8 parcial (`useUIStore` selectivo).

**Arquitectura:** A3 (capas congeladas + reglas eslint), A8
(`ARCHITECTURE.md`).

**Documentación:** este informe.

Todos los cambios pasan `tsc --noEmit`, `eslint`, la suite `vitest` y
`check:i18n`. Los hallazgos marcados 📋 quedan documentados con su fix
propuesto para slices dedicados con cobertura de tests propia.
