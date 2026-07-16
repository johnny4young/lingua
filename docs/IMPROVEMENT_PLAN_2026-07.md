# Lingua — Análisis de estado + Plan de mejora v4 (2026-07-06)

> **v4 = v3 + LANE G (cierre) + scorecard final.** La v2 convirtió el plan
> en especificación técnica (cada item cita APIs REALES del repo,
> verificadas contra `main` @ `351cf02`, v0.10.0, con path:línea, diseño,
> pasos y AC). La v3 añadió el análisis competitivo (4 investigaciones web
> con fuentes) y el LANE F de mercado. La v4 auditó las dimensiones que
> faltaban — accesibilidad + i18n profunda, performance de ARRANQUE,
> resiliencia + paridad cross-platform, y CLI + website/distribución — y
> cierra con el LANE G y el scorecard consolidado de 12 dimensiones (§10).
>
> Hallazgo v4 que corrige al diagnóstico v1: la resiliencia es MEJOR de lo
> asumido — safe mode auto-recuperable (`safeBoot.ts:76-81`), contador de
> boot-loop 3-en-60s → factory reset (`safeBoot.ts:133-176`), crash
> reporter opt-in, y kill de process tree por plataforma
> (`processTree.ts:46-86`) ya existen y están documentados en RECOVERY.md. Los ids son `IT2-*` (no se inventan `RL-XXX`;
> cuando el item ya existe como ticket RL se referencia el id real).
> Para graduar un `IT2-*` al ROADMAP: backlog interno → acceptance criteria
> (protocolo ROADMAP §3).
>
> **Correcciones v2 sobre v1** (evidencia nueva contradijo dos hipótesis):
>
> 1. Los 30 paneles de utilidades **ya se cargan lazy** —
>    `PANEL_LOADERS` usa dynamic imports + `React.lazy` + `Suspense`
>    (`UtilityPanelRegistry.ts:26-61`, `UtilityPanels.tsx:26-33`) y solo el
>    panel activo se monta. El viejo IT2-B3 ("code-split por panel") queda
>    reducido a una verificación de chunking (§B3).
> 2. `PanelChipsRow` **ya usa selectores primitivos** para los contadores
>    (`AppLayout.tsx:188-193`). El sospechoso real de re-render es
>    `useActiveTab` (devuelve el objeto tab, que cambia en cada keystroke
>    por `content`). B4 se reescribió sobre esa evidencia.

## Decisiones de negocio aprobadas (2026-07-06)

Las tres decisiones que la v4 dejó abiertas fueron **confirmadas por el
dueño del producto el 2026-07-06**. Ya no son "pendientes": son spec.

1. **Free 1 → 3 tabs.** APROBADO. Spec en IT2-D1. (Snippets 5→25 NO fue
   parte de esta aprobación — sigue como recomendación abierta en §F-P.)
2. **Lifetime a $59, con el modelo sostenible** (perpetua + 12 meses de
   updates + renovación opcional con descuento; los entitlements NO
   caducan). APROBADO — se mantiene el precio $59, NO se sube a $79.
   Spec técnica nueva en IT2-D8 (mapea sobre el token que ya existe:
   tier `pro_lifetime` + `supportWindowEndsAt`).
3. **Publicar el CLI a npm.** APROBADO. Spec en IT2-G9; la cadena de
   publicación va dentro del scope de RL-098.

## 0. Razón de ser (ancla de todo)

Lingua es el RunJS multi-lenguaje: **"open, write, run"** offline-first.
Tesis vigente (ROADMAP §5a): *workspace local-first donde un dev corre
código o una herramienta, captura input/output/environment exacto, y lo
replay/comparte sin filtrar secretos*. Cada item de este plan fortalece uno
de los tres loops (core / workflow artifacts / execution-adjacent tools) o
reduce el costo de mantenerlos. El objetivo emocional: que el usuario
sienta que la app *recuerda, anticipa y celebra* su trabajo — sin nube, sin
cuentas, sin fricción.

## 1. Diagnóstico resumido (detalle en §9)

Fortalezas: IPC tipado por contrato, FS por capabilities, spawn engine
unificado, licensing offline, stack al día, onboarding <90 s.
Deudas: un componente renderer aún supera 800 LOC; 0 coverage
instrumentado; bootstrap de runtimes sin progreso; cero loops de retención.
El god-file `fileSystem.ts`, el contrato de workers, T6 y la virtualización de
FileTree ya quedaron cerrados con límites estructurales automatizados.
El Run Ledger y el rebalanceo Free a 3 tabs ya cerraron los dos gaps que
esta auditoría describía como historial volátil y gating hostil.
El hallazgo de performance P6 también quedó cerrado el 2026-07-12: los probes
de filesystem de Node, Ruby y dependencias usan `fs/promises`, mantienen sus
contratos IPC y cuentan con un guard que impide reintroducir llamadas síncronas
en esos hot paths.

---

# LANE A — Mantenibilidad

## IT2-A1 · Split de `src/main/ipc/fileSystem.ts` (1.904 LOC) — EJECUTADO 2026-07-10

> **Estado de ejecución.** La primera pasada extrajo VERBATIM los bloques
> cohesivos que NO tocan estado mutable de módulo: `fs/fsShared.ts` (117
> LOC — helpers puros: shouldHide/joinRelative/dirnameRelative/isRecord/
> coerce*/CapabilityError/resolveOrThrow), `fs/fsSearchReplace.ts` (569
> LOC — searchInFiles/replaceInFiles/applyReplaceInFile + walkProject),
> `fs/fsBundle.ts` (216 LOC — export/importBundle; recibe
> `rememberApprovedRoot` como parámetro inyectado). La segunda pasada movió
> aprobaciones (`fsApprovals.ts`, 167 LOC), operaciones/pickers/dialogs
> (`fsOperations.ts`, 543 LOC) y todo el registro/lifecycle mutable de watchers
> (`fsWatchers.ts`, 315 LOC). `fileSystem.ts` bajó 1904 → 1052 → **40 LOC** y
> quedó como assembly puro con re-exports compatibles para `git.ts` y tests.
> Los seis módulos quedan por debajo de 600 LOC. Un test estructural bloquea
> regresiones del assembly y del presupuesto; 115 tests IPC/watcher/git y 296
> pruebas focalizadas de la ronda pasan sin cambiar contratos ni asserts.

**Evidencia (mapa estructural real).** Estado module-level: `watchers`
(L83), `watcherIdsByTarget` (L84), `watcherIdsBySender` (L91),
`nullFilenameBursts` (L470); approvals: `loadFilesystemApprovals` (L138),
`persistFilesystemApprovals` (L164), `pathIntersectsApprovedScope` (L224).
Registro único: `registerFileSystemHandlers()` (L508). El mint/resolve de
capabilities YA vive aparte en `ipc/projectCapabilities.ts` (298 LOC).

**Diseño ejecutado.** 6 módulos bajo `src/main/ipc/fs/`; los grupos con IPC
exportan
`registerXHandlers()`; `fileSystem.ts` queda como assembly (mismo patrón
que los store splits RL-128/129):

| Módulo nuevo | Se lleva (líneas actuales) |
| --- | --- |
| `fsApprovals.ts` | persistencia de approvals + checks de scope usados por Git y reopen |
| `fsOperations.ts` | pickers/reopen/revoke/dialogs + readdir/listAllFiles/stat/read/write/delete/rename/mkdir/touch/reveal |
| `fsSearchReplace.ts` | `fs:searchInFiles` L864 + `fs:replaceInFiles` L1097 |
| `fsWatchers.ts` | los 4 Maps de watchers + stopWatcherById/ForSender/All L385-421 + watch-start/stop/change-handler L1591-1896 |
| `fsBundle.ts` | pack/unpack L1705-1777 |

**Pasos.** (1) Crear módulos moviendo código VERBATIM (sin re-firmar nada);
(2) los Maps de watchers se exportan solo desde `fsWatchers.ts` (los otros
módulos no los tocan — verificar con grep antes de mover); (3) `fileSystem.ts`
importa y delega; (4) correr `tests/main/*` sin editar un solo assert.

**AC.** Cero cambio de comportamiento; contrato IPC intacto; cada módulo
<600 LOC; re-exports públicos de approvals/watchers intactos. El split
multi-destino queda visible como movimiento mecánico dentro de un solo commit.

## IT2-A2 · Consolidar boilerplate de paneles de utilidades — CERRADO 2026-07-13

**Evidencia.** `Base64UtilityPanel.tsx:1-62` es representativo: cada panel
repite `useState` de mode/input + `useCallback(registerOutput)` +
`useRegisterUtilityOutput` (`useRegisterUtilityOutput.ts:27-63`) +
`UtilityToolbar` + `TwoPaneTransformPanel`
(`panelPrimitives.tsx:305-325`, props: `title/description/input/
onInputChange/output/errorKey/layout`). La duplicación es de *ciclo*, no de
UI (los primitives ya existen).

**Diseño.** Hook `useTransformUtilityPanel` en
`src/renderer/components/DeveloperUtilities/useTransformUtilityPanel.ts`:

```ts
export function useTransformUtilityPanel(args: {
  utilityId: DeveloperUtilityId;
  initialInput: string;
  transform: (input: string) => { output: string; errorKey: string | null };
}): {
  input: string;
  setInput: (v: string) => void;
  output: string;
  errorKey: string | null;
};
// internamente: deriva output/errorKey, memoiza el provider
// (errorKey ? null : output || null) y llama useRegisterUtilityOutput.
```

**Pasos.** (1) Hook + test unitario; (2) migrar Base64 como referencia y
verificar con web smoke que Cmd+Shift+C (copy output) y Apply siguen
funcionando; (3) migrar solo los paneles que calcen sin forzar (los
two-pane puros: url, string-case, html-entity, backslash-escape, number-base,
yaml-json, json-csv…); los paneles con estado propio complejo (regex, diff,
qr-code, mock-data) NO se fuerzan al hook.

**AC.** Paneles migrados quedan <45 LOC; `useRegisterUtilityOutput` se
llama exactamente una vez por panel montado; smoke web con
`browser_console_messages({level:'error'})` = 0.

**Cierre 2026-07-13.** `useTransformUtilityPanel` concentra el estado de input,
la derivación síncrona y el provider nulo ante error. Base64 quedó como
referencia (61→44 LOC) y URL como el único segundo consumidor que cumple el
contrato sin duplicar cómputo (62→44 LOC); ambos comparten además el selector
encode/decode. El inventario corrigió la lista tentativa: String Case necesita
múltiples salidas; HTML Entity y Backslash exponen metadatos; Number Base tiene
varias vistas editables; YAML/JSON y JSON/CSV conservan dos inputs por dirección.
Forzarlos habría empeorado el diseño, así que permanecen explícitamente fuera.
El test del registry fija una sola ruta de registro y el budget de 45 LOC para
cualquier consumidor del hook. Evidencia: unit/component tests, 269 E2E web,
smoke manual EN/ES con Apply, Cmd+Shift+C, error paths y consola sin errores;
capturas en `output/review/a2-transform-base64/` y
`output/review/a2-transform-url/`.

## IT2-A3 · Desacoplar stores — ejecutar RL-133 → RL-134 → RL-135

Tickets ya planeados con AC propios en el audit interno. Contexto para el
implementador: el peor acoplamiento es `editorCloseActions.ts` (importa 5
stores); `pushStatusNotice` tiene 134 call sites (RL-134 los envuelve);
RL-135 reemplaza los bridges `window.dispatchEvent`. No re-especificar aquí.

**Estado 2026-07-14.** `RL-133` cerrado: el contrato IPC esperado converge en
`Result<T, E>` para profile/recovery, licencia y solicitudes LSP Rust/Go; cada
superficie renderer lo consume en un único adaptador. `RL-134` también cerrado:
una API estable por tono (`useStatusNotice` + helpers imperativos) preserva las
opciones del notice y ya reemplaza 54 productores de alto tráfico. `RL-135`
cerrado: un mapa cerrado de comandos reemplaza los bridges de coordinación
basados en `window.dispatchEvent`, con entrega síncrona sin replay, prioridad,
orden estable y fallback marcado como atendido. La cobertura incluye entrega
repetida, limpieza en Strict Mode, ausencia estructural de nuevos bridges DOM y
flujos web/nativos; evidencia visual en `output/review/rl135-command-bus/`.

## IT2-A4 · Contrato tipado para workers — EJECUTADO 2026-07-09 (alcance corregido)

> **Estado de ejecución + corrección de alcance.** El inventario (paso 1
> del diseño) invalidó parte de la premisa: `WorkerResponse` en
> `types/index.ts` YA era un union completo y el runner YA lo consumía
> tipado. Los gaps REALES eran dos: (a) el handler entrante del worker
> leía `event.data` como any con casts por rama (`msg as ExecuteMessage`,
> `msg.mode as StepMode`), y (b) el `WorkerRequest` exportado estaba
> MUERTO y mentía (declaraba un mensaje `stop` que no existe — los
> runners hacen `terminate()` — y omitía las variantes del debugger).
> Aplicado: `DebuggerControlMessage` exportado desde
> `debuggerWorkerBridge` (single source of truth del lado emisor),
> `WorkerInboundMessage = ExecuteMessage | DebuggerControlMessage` en el
> worker con UNA aserción deliberada en el boundary + narrowing por
> `type` sin casts + guard de exhaustividad `never` (una variante nueva
> sin rama = error de compilación en el tsc de CI); `WorkerRequest`
> eliminado con nota puntero. E3: test de contrato del bridge
> (`tests/renderer/runtime/debuggerWorkerBridge.test.ts` — round-trip
> verbatim de las 3 variantes, refuse sin worker, terminated-worker no
> lanza). Python/ruby workers: sus protocolos son mono-variante
> (`init`/`execute`) y quedan para cuando crezcan.

**Evidencia.** Los 3 workers hablan `{ type, runId, ...payload }` ad-hoc:
`js-worker.ts` emite `console` (L387), `result` (L462), `resumed` (L827),
`scope-snapshot` (L1068), `done` (L1101); el runner postea
`{ type:'execute', runId, code, debug, breakpoints, magicKindByLine, stdin,
captureScope }` (`runners/javascript.ts:250-290`) y ya filtra por runId
(guard RL-078). No existe tipo compartido — cada lado castea.

**Diseño.** `src/shared/workerContract.ts`:

```ts
export type JsWorkerRequest =
  | { type: 'execute'; runId: string; code: string; debug?: boolean;
      breakpoints?: number[]; magicKindByLine?: Record<number, MagicCommentKind>;
      stdin?: string; captureScope?: boolean }
  | { type: 'stop'; runId: string }; // + variantes debugger reales

export type JsWorkerResponse =
  | { type: 'console'; runId: string; method: 'log'|'warn'|'error'|'info';
      args: string[]; payload?: RichOutputPayload[] }
  | { type: 'result'; runId: string; line: number; value: string;
      payload?: RichOutputPayload[] }
  | { type: 'scope-snapshot'; runId: string; snapshot: ScopeSnapshot }
  | { type: 'resumed'; runId: string }
  | { type: 'done'; runId: string; executionTime: number };
```

(Los shapes EXACTOS se transcriben del switch actual de cada worker al
migrar — el paso 1 es inventariarlos, no inventarlos.) Helpers
`postTyped(worker, msg)` / worker-side `replyTyped(ctx, msg)` con el union
como único tipo aceptado. Espejo para python/ruby (`PyWorkerRequest`…).

**Pasos.** (1) Inventariar TODAS las variantes reales por worker (grep
`postMessage` en cada worker + listener del runner); (2) declarar unions;
(3) tipar ambos lados sin cambiar payloads; (4) test de exhaustividad
(switch con `never` en default).

**AC.** Cero casts `as` en los listeners de runners; una variante nueva sin
handler = error de compilación; runs de JS/TS/Python/Ruby verdes en smoke.

## IT2-A5 · Partir hooks gigantes — CERRADO 2026-07-13 (4/4)

`useAutoRun.ts` pasó 620→151 LOC al separar decisiones puras en
`autoRunModel.ts` (55), ejecución/gates en `autoRunExecution.ts` (226) y
publicación de resultados/telemetría en `autoRunResult.ts` (119). Los budgets
automatizados fijan el hook por debajo de 300 LOC y los tres módulos por debajo
de 120-300; `autoRunModel` tiene tests propios y la suite existente del hook
conserva sus carreras manual/auto, gates y entradas efectivas.

`useImportPreview.ts` pasó 574→79 LOC: detección, preview y variables Postman
quedaron en `importPreviewModel.ts` (189), y la confirmación con escrituras en
stores quedó en `importPreviewConfirm.ts` (223). El modelo suma tests directos;
la confirmación también fija directamente su contrato de cierre/reset, y la
suite existente conserva cURL, ipynb, linguanb, Postman, Bruno, warnings,
telemetría, cancelación y estados rechazados.

`useGlobalShortcuts.ts` pasó 533→46 LOC: tipos, matching del catálogo, mapa de
acciones, gates del debugger y acciones de utilities quedaron en cuatro módulos
enfocados de 32-117 LOC. El matching y las acciones de utility tienen tests
directos; la suite existente conserva defaults, overrides, Escape, overlays,
clipboard y controles del debugger. Evidencia reproducible:
`output/review/a5-global-shortcuts-split/`.

`useProjectWatchSync.ts` pasó 488→75 LOC: coalescing y precedencia de eventos,
prompts de recarga externa y detección de tabs eliminados quedaron en tres
módulos enfocados de 49-165 LOC. Los tres helpers tienen tests directos; las
suites existentes conservan debounce, cambios de proyecto, delta refresh,
autosaves, dirty buffers, lotes, telemetría y cleanup del watcher. Evidencia
reproducible: `output/review/a5-project-watch-sync-split/`.

IT2-A5 queda cerrado con los cuatro hooks por debajo de 300 LOC, helpers con
budgets automatizados y cero cambio intencional de comportamiento.

## IT2-A6 · Higiene de dependencias — CERRADO 2026-07-06 (resultado: no-op)

**Corrección en ejecución (Fase 1).** La afirmación "0 imports" de la
auditoría era FALSA: `scripts/build-desktop-bundles.mjs:26` importa
`@electron-forge/plugin-vite/dist/ViteConfig.js` (el generador de config
Vite que replica el grafo de build que `electron-forge package` producía —
pieza viva del empaquetado con electron-builder) y `forge.env.d.ts`
(referenciado en el `include` de `tsconfig.json:24` y
`tsconfig.test.json:23`) consume sus tipos. **La dependencia NO es
removible** sin reescribir el pipeline de bundles desktop — eso sería un
refactor con riesgo de packaging, no higiene. `pnpm run check:deadcode`
(knip) corre LIMPIO: no hay dependencias ni archivos muertos que retirar.
Removerla de verdad queda como opción futura solo si se replica
`ViteConfigGenerator` en `scripts/` (no recomendado hoy).

## IT2-A7 · Doc-sync — S (0.5 d)

`docs/ARCHITECTURE.md:406-409` describe el drift de tiers de licencia
(4 vs 6) como pendiente; ya está resuelto — `src/shared/license.ts:24` y
`src/types.d.ts` son ambos 6-tier
(`free|pro|pro_lifetime|team|trial|education`). Actualizar la nota.
Registrar este doc en `docs/README.md` si se conserva.

---

# LANE B — Performance

## IT2-B1 · Descarte de output tras truncation en T6 — EJECUTADO 2026-07-06 (Fase 1)

> **Estado de ejecución.** Aplicado en `spawnNativeRun.ts` con handlers
> nombrados: al cruzar el cap, `off('data')` + `resume()` (destroy()
> descartado por riesgo EPIPE, como especificaba el diseño). Contrato
> testeado en `tests/main/spawnNativeRun.test.ts` (detach + resume + cero
> crecimiento post-cap + stderr intacto). Colateral corregido: el fixture
> de `tests/main/ruby-runner.test.ts` fakeaba stdout sin `resume` y su
> test de cap de 1 MiB lo ejercita — fixture completado para modelar la
> superficie real del stream.

**Evidencia.** `spawnNativeRun.ts:221-241`: los listeners `data` hacen
early-return cuando `stdoutTruncated`, pero **siguen suscritos** — Node
sigue entregando chunks (`chunk.toString()` incluido) de un proceso que
puede emitir cientos de MB hasta el timeout. La acumulación se detiene; el
costo de recepción/parseo no.

**Diseño.** Al marcar truncation, cortar la recepción:

```ts
if (stdout.length > maxOutputBytes) {
  stdout = truncateBytes(stdout, maxOutputBytes, stdoutTruncationMarker);
  stdoutTruncated = true;
  child.stdout.removeAllListeners('data');
  child.stdout.resume();   // drena y descarta sin acumular ni parsear
}
```

(idéntico para stderr). NO usar `destroy()` — cerrar el pipe puede provocar
EPIPE en el hijo y cambiar su comportamiento; el contrato actual (el
proceso sigue vivo hasta exit/timeout) se mantiene.

**AC.** Test en `tests/main/` con un proceso sintético
(`node -e 'while(1) console.log("x".repeat(65536))'` + `timeoutMs` corto):
resultado truncado con marker, y heap del main estable (asserts sobre el
tamaño de `stdout` capturado, no sobre RSS — determinista). Runs normales
de Go/Rust/Ruby sin cambio (smoke desktop).

## IT2-B2 · Virtualizar FileTree — EJECUTADO 2026-07-06 (Fase 1)

> **Estado de ejecución.** Implementado: `fileTreeRows.ts` (modelo de fila
> plana con filas sintéticas `create`/`empty-dir` para preservar la
> geometría del scroll), `FileTree.tsx` renderiza la lista ventaneada con
> `useListWindow` (spacers + `measureRef` + `scrollToIndex` en el focus de
> teclado), y `FileTreeNode.tsx` dejó de recursar (renderiza UNA fila;
> `role="treeitem"` + `aria-level` YA existían y se preservaron — el árbol
> plano es patrón ARIA válido sin `role="group"`). AC ajustado con
> honestidad: jsdom no hace layout (el windower degrada a lista completa
> por diseño), así que el "<100 filas montadas" se prueba sobre
> `computeWindow` puro (`tests/components/fileTreeRows.test.ts`, 5.000
> filas → slice acotado + spacers exactos) y las 5 suites existentes del
> árbol (28 tests) validan teclado/rename/dirty-dot sin ediciones.

**Evidencia.** El render actual es recursión de componentes
(`FileTree.tsx:378-401` mapea raíces; `FileTreeNode.tsx:394-410` se
auto-recursa) — O(nodos visibles) componentes montados. Ya existen las dos
piezas para virtualizar: `flattenVisibleTree(nodes, parentPath)`
(`FileTree.tsx:36-48`, aplana respetando `isExpanded`) y `useListWindow`
(`useListWindow.ts:203-208`; retorna `listWindow` con
`startIndex/endIndex/topSpacer/bottomSpacer`, `measureRef`,
`scrollToIndex` — mismo hook que virtualiza Notebook y Console).

**Diseño.** Reemplazar la recursión por lista plana ventaneada:

1. `const flat = useMemo(() => flattenVisibleTree(nodes), [nodes])`.
2. `useListWindow({ scrollRef, keys: flat.map(e => e.node.path), estimate: 28 })`.
3. Render: spacer top → `flat.slice(startIndex, endIndex+1)` como
   `<FileTreeRow node depth={…}>` (depth = profundidad calculada en el
   flatten — extender `flattenVisibleTree` para incluirla) → spacer bottom.
4. `FileTreeNode` deja de recursar; conserva íntegros el menú contextual,
   rename inline, `data-tree-row`, y `handleTreeKeyDown` (la navegación
   Arrow/Home/End ya opera sobre paths — reutilizar `scrollToIndex` para
   revelar la fila al navegar con teclado).

**AC.** Con 5.000 nodos visibles, <100 filas montadas (assert en test de
componente contando `data-tree-row`); navegación por teclado y rename
intactos (tests existentes de FileTree verdes); smoke web con proyecto
real; el accent de tab activa (PERF-001) sigue funcionando.

## IT2-B3 · Verificación de chunking de paneles — CERRADO 2026-07-06 (verificado, no-op)

Verificado en `build:web` del 2026-07-06: cada panel genera su chunk
propio en `dist/web/assets/` (`Base64UtilityPanel` 1.5k …
`QrCodePanel` 145k, ~34 chunks de panel) con `panelPrimitives` (9.1k) y
el shell `DeveloperUtilities` (19k) compartidos. Vite NO los agrupó;
ninguna acción necesaria.

## IT2-B4 · Selectores primitivos en `PanelChipsRow` — EJECUTADO 2026-07-06 (Fase 1)

> **Estado de ejecución.** Mecanismo confirmado (el `useShallow` de
> `useActiveTab` no salva: `content` ES un campo shallow del tab, cambia
> por keystroke). Fix aplicado: 6 suscripciones primitivas
> (id/language/runtimeMode/stdinLineCount/compareEnabled/
> variableInspectorEnabled); `useActiveTab` eliminado del archivo. AC
> verificado de forma determinista con un test de contrato
> (`tests/components/panelChipsRowRerender.test.tsx`, patrón
> `editorStoreSelectorRenders` + `<Profiler>`): 2 `updateContent` → 0
> commits de la fila; flip del compare flag → sí re-renderiza.
> `PanelChipsRow` quedó exportado solo para ese test.

**Evidencia.** `AppLayout.tsx:170-193`: los contadores ya son selectores
primitivos (`comparableSnapshotCountFor`), pero la primera línea es
`const activeTab = useActiveTab()` — devuelve el OBJETO tab, cuya identidad
cambia en cada keystroke (el `content` muta), re-renderizando toda la fila
de chips. El propio archivo documenta el patrón correcto (PERF-001,
L131-148): *"computed from narrow primitive selectors, never the whole
tabs array, so editor keystrokes leave this untouched"*.

**Diseño.** (1) Medir primero: React DevTools Profiler tipeando 10
caracteres — confirmar que `PanelChipsRow` re-renderiza. (2) Si confirma:
reemplazar `useActiveTab()` por los selectores primitivos que la fila
realmente usa (`activeTab?.language`, flags de compare/inspector):

```ts
const activeTabLanguage = useEditorStore(s => getActiveTab(s)?.language ?? null);
const compareEnabled   = useEditorStore(s => getActiveTab(s)?.compareEnabled ?? false);
```

(cada selector devuelve primitivo → zustand solo re-renderiza si el valor
cambia). Pasar `activeTabLanguage` a los selectores de counts.

**AC.** Profiler: 0 re-renders de `PanelChipsRow` al tipear con estado de
chips estable; los chips siguen reaccionando a cambio de tab/lenguaje.

## IT2-B5 · CI a <15 min — M (1-2 d)

**Evidencia.** `ci.yml` job `linux-gates`: 17 steps secuenciales
(typecheck L49, typecheck:tests L59, lint L61, i18n L63/65, changelog L67,
license-rotation L73, test L75, update-server L82-87, build:web L89,
performance L91/93, licenses L95, prod-audit L102, audit L104); cache pnpm
dual-lockfile L39-46.

**Diseño.** 3 jobs paralelos que reutilizan el mismo bloque de setup
(checkout + pnpm + cache): **static** (typecheck + typecheck:tests + lint +
i18n + changelog + license-rotation), **test** (pnpm test + update-server
gates), **build** (build:web + performance + licenses + prod-audit +
audit-advisory). `windows-path-hardening` queda igual.

**AC.** Wall-clock de PR < 15 min (medir 3 PRs); exactamente los mismos 17
comandos repartidos — ninguno eliminado; `needs:` solo donde haya
dependencia real (build no necesita test).

### Cierre de auditoría de rendimiento P3/P4/P7 — EJECUTADO 2026-07-10

Tres hallazgos de la revisión profunda quedaron cerrados como una misma ronda
medible: la tira de `EditorTabs` ya no se suscribe al contenido completo, el
locale español se carga como chunk diferido y el trabajo pesado de Diff Viewer
y Utility Pipelines usa un Web Worker tipado. Se conservaron caminos inline
para diffs pequeños y entornos sin Worker. El build de evidencia redujo el
chunk inicial de la aplicación en ~70 kB gzip y emitió chunks separados para el
catálogo ES (~70 kB gzip) y el worker (~34 kB sin comprimir). Validación y
capturas: `output/review/project-sequence/t07-performance/`.

---

# LANE C — Datos: el Run Ledger (modelos de DB)

## IT2-C1 · `lingua_ledger` sobre el motor DuckDB existente — EJECUTADO 2026-07-09

> **Estado de ejecución.** Implementado en `runtime/runLedger.ts`: DDL
> idempotente (schema + runs/capsules/daily_activity), cola de escrituras
> serializada, re-ensure + retry ante reinicios del engine compartido,
> retención Free 7 días (lazy, una vez por sesión, gated en
> EXECUTION_HISTORY), clear = DROP SCHEMA CASCADE, export JSON. El tap
> (`hooks/useRunLedgerTap`, montado en App) se suscribe a
> executionHistoryStore — cuyos call sites son EXACTAMENTE los runs
> manuales (editor/SQL/HTTP/pipeline; los auto-runs nunca registran ahí,
> así que no hay flooding) — con guard por entry-id para ignorar
> mutaciones no-run (pin/clear). Hash vía computeContentHash reutilizado
> de runCapsule; una capsule se reduce a un resumen de metadatos antes de
> persistirse: código, stdin, output, errores, diagnósticos, rich output,
> nombres de tabs y metadatos Git jamás tocan la DB (test lo bloquea).
> Setting `runLedgerEnabled` default OFF cableado en los 6 puntos
> (types/defaults/partialize/merge/actions). Privacy UI: card con toggle
> + estado de durabilidad (ligado al opt-in OPFS existente) + Export
> JSON (Blob download) + Clear; trust feature nuevo `run-ledger` +
> telemetría `ledger.toggled { enabled }` / `ledger.cleared`. 7 tests de
> contrato con el mock-engine seam de duckdbClient (OFF-escribe-nada,
> DDL-once, escaping, retención por tier, capsule-link, drop+recreate,
> export). daily_activity usa el día LOCAL (en-CA) para streaks humanos.

**Evidencia.** Ya existe todo el sustrato: `getDuckDbEngine()`,
`executeQuery(query, options)` → `DuckDbExecuteOutcome`
(`duckdbClient.ts:57-81`), persistencia OPFS opt-in con fallback in-memory
(`applyDuckDbPersistence`, L223-244, con CHECKPOINT post-write L852-857).
El historial actual es volátil: `ExecutionHistoryEntry`
(`executionHistoryStore.ts:46-93`) con `MAX_HISTORY_ENTRIES = 50` in-memory
y capsules LRU 5/20 (L188, L141-149). Los runs ya escriben ahí — call site
tipo `useExecutionHistoryStore.getState().record({...})`
(`SqlWorkspacePanel.tsx:329-334`). La capsule ya tiene schema estable
`RunCapsuleV1` (`runCapsule.ts:113-128`) con redacción por diseño
(`privacy.redactionVersion`, caps 1 MiB/stream y 4 MiB total).

**Diseño.** Módulo nuevo `src/renderer/runtime/runLedger.ts`:

- Vive en la MISMA base OPFS del SQL workspace (comparte el opt-in
  existente `configureDuckDbPersistence` / `sqlWorkspacePersistTables`), en
  el schema `lingua_ledger`. Sin persistencia activada → el ledger opera
  in-memory (sesión actual) y la UI lo dice.
- API: `recordRun(entry: LedgerRunInput): Promise<void>` (fire-and-forget,
  post-run, NUNCA en el hot path — se llama desde los mismos call sites que
  hoy llaman `executionHistoryStore.record`), `queryRecentRuns()`,
  `getDailyActivity()`, `clearLedger()`, `exportLedgerJson()`.
- DDL (idempotente, `CREATE SCHEMA IF NOT EXISTS` al primer uso):

```sql
CREATE SCHEMA IF NOT EXISTS lingua_ledger;

CREATE TABLE IF NOT EXISTS lingua_ledger.runs (
  run_id         UUID PRIMARY KEY,
  tab_id         TEXT,
  language       TEXT NOT NULL,
  code_sha256    TEXT NOT NULL,        -- RunCapsuleV1.source.contentHash; nunca el código
  started_at     TIMESTAMP NOT NULL,
  duration_ms    INTEGER,
  status         TEXT NOT NULL CHECK (status IN ('ok','error','timeout','cancelled')),
  capsule_id     UUID
);

CREATE TABLE IF NOT EXISTS lingua_ledger.capsules (
  capsule_id     UUID PRIMARY KEY,
  schema_version TEXT NOT NULL,        -- 'RunCapsuleV1' (version:1)
  created_at     TIMESTAMP NOT NULL,
  language       TEXT,
  payload        JSON NOT NULL,        -- resumen de metadatos, sin contenido del usuario
  size_bytes     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lingua_ledger.daily_activity (
  day            DATE PRIMARY KEY,
  runs_count     INTEGER NOT NULL DEFAULT 0,
  languages_used JSON NOT NULL DEFAULT '[]',
  utilities_used INTEGER NOT NULL DEFAULT 0
);
```

- **Privacidad (innegociable):** setting nuevo `runLedgerEnabled`
  (default OFF) siguiendo el patrón verificado: añadir a
  `settingsPartialize` (`settingsPersistence.ts:37-112`), sanitizer boolean
  en `settingsSanitizers.ts`, action en `settingsSessionActions.ts` —
  campo aditivo con default ⇒ NO requiere bump de versión de migración
  (el merge sanitizer rellena ausencias). Botón "Borrar historial"
  (`clearLedger()`) + export JSON en Settings → Privacy. Registrar trust
  event (patrón `licenseTrustCapture.ts`) en cada activación. Telemetría:
  añadir `'ledger.enabled': []`, `'ledger.cleared': []` al
  `EVENT_PROPERTY_ALLOWLIST` (`src/shared/telemetry.ts:596+`).
- **Retención por tier:** Free 7 días / Pro ilimitado (job de limpieza al
  boot: `DELETE FROM lingua_ledger.runs WHERE started_at < now() - INTERVAL 7 DAY`
  cuando `!isEntitled(tier,'EXECUTION_HISTORY')` — API real de
  `entitlements.ts`). Consistente con la retención tier-aware de capsules.
- El usuario puede tocar el schema con SQL (misma DB): es SU data —
  documentarlo en USAGE.md como feature, no protegerlo.

**Pasos.** (1) `runLedger.ts` + DDL + tests unitarios con engine in-memory;
(2) setting + Settings UI + trust event; (3) conectar los call sites de
`record(...)` (editor runs, SQL, HTTP, notebook) con un tap no-bloqueante;
(4) retención por tier; (5) USAGE.md + smoke web (activar, correr, ver
tabla, borrar).

**AC.** Con ledger ON y persistencia OPFS: correr código → fila en
`lingua_ledger.runs` con `code_sha256` y SIN código fuente; reload →
sobrevive; "Borrar historial" la vacía; con ledger OFF no se escribe NADA
(assert en test); gates i18n verdes (strings nuevos en/es, tuteo).

**Qué desbloquea:** el remaining scope de **RL-094** (auto-capsule + disk
persistence → tabla `capsules`) y el run-history timeline de **RL-096**.

## IT2-C2 · "Query your own history" en el SQL workspace — EJECUTADO 2026-07-09

> **Estado de ejecución + corrección.** La premisa "las tablas aparecen
> solas" era parcialmente falsa: el browser usaba SHOW TABLES, que solo
> ve el schema `main`. Corregido: la introspección ahora lista
> `information_schema.tables` calificando los schemas no-main, así
> `lingua_ledger.runs`/`.capsules`/`.daily_activity` aparecen en el
> browser con el nombre EXACTO que una query debe usar (autocomplete
> veraz incluido — las columnas se agrupan por el mismo nombre
> calificado). Docs + snippet de ejemplo en USAGE.md § Run Ledger.

**Evidencia.** El schema browser hace introspección genérica — `SHOW
TABLES` + `information_schema.columns` filtrando solo
`information_schema/pg_catalog` (`SqlWorkspacePanel.tsx:366-419`) — así que
las tablas de `lingua_ledger` **aparecen solas** en cuanto existen en la
misma DB. El trabajo real es presentación y docs, no plumbing.

**Diseño.** (1) Agrupar el schema `lingua_ledger` en una sección propia del
schema browser con badge "Lingua" (orden: user tables primero); (2) snippet
de ejemplo en el workspace vacío:
`SELECT language, count(*) runs, avg(duration_ms) avg_ms FROM lingua_ledger.runs GROUP BY 1 ORDER BY 2 DESC;`
(3) sección en USAGE.md. Nadie más en la categoría tiene esto: tu historial
de ejecuciones es una tabla SQL consultable con la propia app.

**AC.** Con ledger ON, el browser muestra el grupo `lingua_ledger` con
columnas; el snippet corre; con ledger OFF el grupo no aparece.

---

# LANE D — UX: que se enamoren (retención local-first)

## IT2-D1 · Rebalancear el gating Free — EJECUTADO 2026-07-10 · S (0.5 d)

**Evidencia.** `FREE_TIER_LIMITS = { maxOpenTabs: 1, maxSnippets: 5,
allowedLanguages: [js, ts, python, ruby] }` (`entitlements.ts:38-46`);
`FREE_TIER_ENTITLEMENTS = new Set([])` — Free no tiene NINGÚN entitlement.
El gate ya es civilizado en infraestructura: `withinTabBudget` +
`pushUpsellNotice({ messageKey:'upsell.freeCeilingReached', … })` +
`trackEvent('feature.blocked', { entitlement:'tabs', tier })`
(`editorTabActions.ts:99-111`).

**Spec (aprobada).** (a) `maxOpenTabs: 1 → 3` — cambiar la constante en
`entitlements.ts:38-46` + actualizar los fixtures de los tests de
`entitlements` y `editorTabActions`; la persona objetivo es multi-lenguaje,
que pruebe JS+Python+TS sin pagar y encuentre el paywall cuando ya ama la
app. (b) Enriquecer el upsell notice existente con `actions:` (el campo ya
existe en `StatusNotice`, `uiStore.ts:86-122`): CTA "Ver qué incluye Pro" →
abre Settings → License con la lista visual de entitlements. (c) Medir con
el evento `feature.blocked` ya emitido (dashboard: ¿bajan los blocks, sube
la conversión?).

**Evidencia de mercado (2026-07, ver §F-P).** El Free de 1 tab es más
restrictivo que el benchmark más duro del segmento (TablePlus regala "2 de
todo" sin límite de tiempo); Yaak y Obsidian regalan el producto completo
para uso personal; Bruno regala el core entero. En un producto cuyo pitch
ES multi-lenguaje, 1 tab impide siquiera comparar dos lenguajes lado a
lado: es un gate de evaluación, no de conversión.

**AC.** 3 tabs Free operativos; 4.º tab → upsell con CTA; tests de
`entitlements` y `editorTabActions` actualizados; smoke web verificando el
upsell. (Decisión (a) ya confirmada 2026-07-06 — ver Decisiones aprobadas.)

**Cierre 2026-07-10.** `FREE_TIER_LIMITS.maxOpenTabs` es 3; el cuarto
tab mantiene el evento `feature.blocked` y muestra el upsell centralizado.
Todos los upsells incluyen ahora la CTA localizada "Ver qué incluye Pro",
que abre Settings → Account/License. La suite prueba 3 permitidos/4.º
bloqueado, workspaces exentos y telemetría; el smoke web verifica el límite,
la CTA y el destino visual en License.

## IT2-D2 · Streaks + achievements locales (= RL-046, ya `Planned`) — M (3-4 d)

**Evidencia de las piezas a reutilizar.** (1) Detección por suscripción a
stores — patrón EXACTO ya probado en
`useOnboardingChoreography.ts:76-170`
(`useExecutionHistoryStore.subscribe((state, prev) => …)` sobre
`entries`); (2) toasts con prioridad y CTA —
`pushStatusNotice({ tone:'success', actions:[…], priority:'high',
onSurvived, onDismiss })` (`uiStore.ts:86-122`, clobbering L258-346);
(3) StatusBar extensible (`StatusBar.tsx` + `useStatusBarModel.ts:17-26`);
(4) datos: `lingua_ledger.daily_activity` (IT2-C1).

**Diseño.**
- `src/shared/achievements.ts`: catálogo **closed-enum** (~15 ids):
  `first-run-{python,go,rust,ruby}`, `three-languages-one-day`,
  `ten-runs-day`, `first-capsule`, `first-capsule-diff`, `first-notebook`,
  `first-sql-import`, `first-pipeline`, `streak-{3,7,30}`,
  `hundred-runs-total`. Cada entrada: `{ id, i18nKey, evaluate(activity) }`
  donde `evaluate` es función pura sobre un snapshot de actividad.
- `achievementsStore.ts` (persist `lingua-achievements`, patrón
  version+createMigrate del registry): `{ unlocked: Record<id, isoDate>,
  currentStreakDays, lastActiveDay }`.
- `useAchievementChoreography.ts` (espejo de onboarding): se suscribe a
  `executionHistoryStore`; en cada run OK actualiza streak/actividad,
  evalúa el catálogo, y para cada unlock nuevo dispara UN toast
  `priority:'high'` + `trackEvent('achievement.unlocked', { id })`
  (allowlist: `['id']` — id es closed enum, seguro).
- StatusBar: segmento `StreakSegment` (🔥 + días) visible solo si
  `achievementsEnabled && currentStreakDays >= 2`; click → popover con
  el catálogo (conseguidos a color, pendientes en gris con hint).
- Settings → General: toggle `achievementsEnabled` (default ON,
  **apagarlo oculta TODO** — chip, toasts, popover; audiencia senior manda).
- Microcopy (tuteo neutral, es/en): `"🔥 Racha de {{days}} días"`,
  `"Logro desbloqueado: Políglota — corriste 3 lenguajes hoy"`,
  `"Primera capsule exportada — tu run ya es reproducible"`.

**AC.** Los del ticket RL-046 + estos: unlock exactamente una vez (persistido);
streak sobrevive reload (usa `daily_activity`, no el reloj de sesión);
toggle OFF = cero superficies visibles; `check:i18n` + `check:i18n:copy`
verdes; smoke web del flujo run→toast→popover.

## IT2-D3 · Progreso visible del bootstrap de runtimes — SLICE 1 EJECUTADO 2026-07-16 · M (2 d)

**Evidencia.** Confirmado: NO hay progreso hoy (búsqueda de
onProgress/ReadableStream/Content-Length en python-worker, ruby-worker y
duckdbClient = ausente). Mensajes actuales: estáticos —
`INITIALIZATION_MESSAGES` en `runnerOutput.ts:5-18` ("Loading Python
runtime (Pyodide)..."). URLs resolubles: Pyodide `PYODIDE_INDEX_URL`
(`python-worker.ts:67-84`, define `__LINGUA_PYODIDE_INDEX_URL__`), Ruby
`RUBY_WASM_URL` (`ruby-worker.ts:44-52`). Assets críticos con nombres
conocidos: `runtimeAssets.ts` — pyodide `pyodide.asm.wasm` etc., ruby
`ruby+stdlib.wasm`.

**Diseño.** Técnica de **pre-warm con progreso** (no requiere tocar
pyodide/ruby-wasm):

1. Helper en el worker: `fetchWithProgress(url, onProgress)` — `fetch` +
   `response.body.getReader()` + `Content-Length`; los bytes van al HTTP
   cache del navegador; cuando `loadPyodide`/`RubyVM` piden el mismo URL,
   sirven del cache (mismo origen, GET simple). Si `Content-Length` falta,
   progreso indeterminado (spinner + bytes acumulados).
2. Antes de `loadPyodide()`: `fetchWithProgress(PYODIDE_INDEX_URL +
   'pyodide.asm.wasm', p => ctx.postMessage({ type:'bootstrap-progress',
   runId, loadedBytes: p.loaded, totalBytes: p.total }))`. Ruby: envolver el
   fetch de `RUBY_WASM_URL` que ya existe.
3. Nueva variante `bootstrap-progress` en el contrato de workers (IT2-A4 la
   tipa); el runner la reenvía a `setLoadingMessage` → el mensaje pasa de
   estático a `"Loading Python runtime… 34 MB / 60 MB"`.
4. **Prefetch opt-in** (slice 2): al boot, si un tab reciente es
   python/ruby y `prefetchRuntimesEnabled` (setting nuevo, default ON solo
   desktop), disparar el mismo fetch en idle (`requestIdleCallback`) y
   mostrar chip discreto en StatusBar: "Python listo ✓". Web queda OFF por
   default (datos móviles).
5. Telemetría (allowlist): `'runtime.bootstrap_completed':
   ['language','durationBucket']`, `'runtime.bootstrap_failed':
   ['language','reason']` — buckets, jamás bytes exactos.

**AC.** Primer run de Python con red lenta simulada (DevTools throttling)
muestra progreso creciente; segundo boot con prefetch → run sin espera
perceptible; sin red y sin cache → mensaje de error honesto (no spinner
infinito); offline desktop (assets locales) → el progreso completa
instantáneo sin regresión.

**Estado Slice 1 (2026-07-16): hecho** (sin el prefetch opt-in del punto 4
— Slice 2). Pre-warm con progreso de `pyodide.asm.wasm` en python-worker
y lectura por chunks del fetch existente en ruby-worker (reemplaza
`compileStreaming`; el sha256 path ya materializaba bytes); variante
tipada `bootstrap-progress` en `WorkerResponse` con throttle de 250 ms.
HALLAZGO CLAVE: el boot real ocurre en el handshake `init` de
`ensurePyodide`/`ensureRuby` (no en `execute`), con su propio listener y
sin runId — el reenvío al `bootstrapProgressStore` vive AHÍ, y el
FloatingActionPill lee el store directamente (path-agnóstico: auto-run o
manual). La ventana de init de `executeTabManually` también compone el
mensaje para el Toolbar clásico y emite `runtime.bootstrap_completed`
(`durationBucket` de BOOT_DURATION_BUCKETS) / `runtime.bootstrap_failed`
(`prepare-error`), allowlisted en shared + update-server. El error path
queda igual de honesto (el loader real reporta; el pre-warm es
best-effort). E2E `tests/e2e/bootstrapProgress.spec.ts` con throttle real
vía `page.route` (+2.5 s en el asset): label estático + contador MB en el
pill y run completo. Evidencia en
`output/review/it2-d3-bootstrap-progress/`.

## IT2-D4 · Magic comments descubribles — EJECUTADO 2026-07-15 · S (1 d)

**Evidencia.** Vocabulario REAL (`magicComments.ts:35-124`): `// @watch
expr` (JS_WATCH_RE / PY_WATCH_RE), `// =>` arrow, auto-log, `@timeout <n>
[ms|s|m]` (TIMEOUT_DIRECTIVE_RE, comparte JS/TS/Python), `@origin off`,
`@git-ignore-status`, `@git-watch-head off`; directivas de presentación
`table|chart|image|html` (`MagicCommentDirective`). Infra de providers YA
genérica: `registerLanguageOnce` (`monaco.ts:130-142`) registra por
descriptor `createCompletionProvider` / `createHoverProvider`
(`monaco.ts:173-196`); helper existente `createCompletionProvider(monaco,
COMPLETIONS, { triggerCharacters, getDynamicDefinitions })` (patrón
`pythonCompletions.ts:50-59`); hover de referencia
`pythonHoverProvider.ts:23-50`.

**Diseño.** (1) `magicCommentCompletions.ts` en `completionProviders/`:
catálogo de sugerencias (`@watch`, `@timeout`, `@origin off`, `=>`,
`:table`, `:chart`…) con `documentation` i18n; trigger character `@` y
filtro por contexto (solo dentro de comentario `//` o `#` según lenguaje —
inspeccionar el prefijo de línea en `provideCompletionItems`). (2) Hover
provider sobre líneas que matcheen los regex reales (reusar
TIMEOUT_DIRECTIVE_RE etc. exportándolos) mostrando qué hace la directiva +
ejemplo. (3) Registrarlos en los descriptors de JS/TS/Python vía
`loadEditorProviders` (composición con los providers existentes — verificar
si el descriptor admite múltiples completion providers; Monaco sí:
`registerCompletionItemProvider` es aditivo).

**AC.** Tipear `// @` en JS/TS y `# @` en Python → sugerencias con docs;
hover sobre `// @timeout 5s` explica el timeout; cero sugerencias fuera de
comentarios; i18n en/es; test de componente para el filtro de contexto.

**Cierre 2026-07-15.** Los descriptors de JavaScript, TypeScript y Python
registran providers aditivos con el vocabulario real de `magicComments.ts`;
las sugerencias solo aparecen dentro de comentarios y el hover reutiliza los
parsers de ejecución para evitar documentación divergente. Las pruebas
focalizadas cubren contexto, cadenas, composición de providers e i18n; el smoke
web de producción validó completions en JS/Python y el hover de timeout en
inglés/español con cero errores de consola. Evidencia visual en
`output/review/d4-d5-d7-discoverability/d4-web-en-magic-comment-completions.png`,
`d4-web-es-python-magic-comment-completions.png` y
`d4-web-es-magic-comment-hover.png`.

## IT2-D5 · What's New activo — EJECUTADO 2026-07-15 · XS-S (0.5 d, con verificación previa)

**Evidencia (parcial — verificar primero).** Ya existen `lastSeenVersion` /
`setLastSeenVersion` en settings y un efecto en `App.tsx` (~L95-120) que
compara con `appInfo.version` y llama `openOverlay('whats-new')` — pero el
extracto sugiere que la apertura está condicionada a `overlay !== 'none'`
(transcripción aproximada). **Paso 0 obligatorio: leer ese efecto completo.**

**Diseño condicional.** Si hoy abre el overlay completo tras cada update:
suavizarlo a toast (`pushStatusNotice` `priority:'normal'`, tone `info`,
action "Ver novedades" → `openOverlay('whats-new')`) — un overlay modal
sin pedirlo es intrusivo; un toast con CTA invita. Si hoy NO se muestra
nada: implementar ese toast. Ambos casos: máximo 1 vez por versión
(el flag `lastSeenVersion` ya lo garantiza), toggle en Settings.

**AC.** Simular upgrade (bajar `lastSeenVersion` en localStorage) → toast
una sola vez, CTA abre el overlay; toggle OFF lo silencia.

**Cierre 2026-07-15.** El efecto real abría el overlay completo; ahora reconoce
la versión al iniciar y, solo después de un upgrade, publica un aviso informativo
normal con CTA hacia Novedades. Una instalación nueva queda en manos del
onboarding sin superficies simultáneas. `whatsNewNotificationsEnabled` persiste y se
sanea en el boundary de Settings; al apagarlo, la versión se reconoce sin
mostrar avisos atrasados al reactivarlo. Pruebas focalizadas cubren StrictMode,
primer boot, opt-out y CTA; el smoke web de producción validó una única aparición,
persistencia EN/ES y cero errores de consola. Evidencia visual en
`output/review/d4-d5-d7-discoverability/d5-web-en-upgrade-notice.png`,
`d5-web-en-whats-new-overlay.png` y `d5-web-es-whats-new-opt-out.png`.

## IT2-D6 · Quick wins del roadmap ya especificados

**RL-113** (Cmd+; recent commands — el `CommandEntry`
(`commandPaletteModel.ts:25-33`) y los builders L471-545 son la base: un
ring de 20 ids ejecutados + popover) — **EJECUTADO 2026-07-16**: ring
sesión-only en `commandHistoryStore` (dedupe-to-top, cap 20), tap en el
único punto de ejecución del palette, y Cmd+; abre el MISMO palette en
variant `recent` (slots 1-8 numerados, timestamps relativos, Enter/1-8
ejecutan y cierran, sin búsqueda libre). E2E
`tests/e2e/recentCommands.spec.ts` cubre los tres AC; evidencia en
`output/review/rl-113-recent-commands/`. **RL-115** — **EJECUTADO 2026-07-16**: walker compartido con auto-log
detecta inicios de statement top-level (conservador: un marker de menos
es inocuo, uno de más rompe sintaxis — cron de continuaciones, `while`
de do-while, decoradores); `__mc_tick` delta-timing en el worker con
flush en success Y error; chips `▸ N ms` italic gris en el overlay
inline existente con hot-spot rojo (`data-slowest`); gating por
`// @time` o Settings → Editor → Mostrar tiempos por línea (default
OFF); e2e `tests/e2e/lineTiming.spec.ts`; evidencia en
`output/review/rl-115-inline-timing/`. (`// @time` — extiende el
vocabulario de IT2-D4 y el gutter), **RL-116** (Focus mode) —
**EJECUTADO 2026-07-16**: `presenterModeStore` sesión-only con overrides
en RENDER time (nada muta uiStore/settings persistidos, así un reload en
medio de la presentación jamás corrompe preferencias); oculta sidebar,
Toolbar, FloatingActionPill y StatusBar, editor +4px y consola +2px;
binding **Mod+Alt+P** (el Cmd+K F del spec chocaba con Mod+K de
Utilities, MOV.03) + acción de palette; e2e
`tests/e2e/presenterMode.spec.ts` (font exacto +4 y restauración exacta);
evidencia en `output/review/rl-116-presenter-mode/`. Ejecutar con
sus AC del plan interno; sinergia: hacer RL-115 justo después de IT2-D4.

## IT2-D7 · Hints rotativos en superficies vacías — EJECUTADO 2026-07-15 · S (1 d)

**Diseño.** Catálogo cerrado `src/renderer/data/hints.ts` (~20 entradas,
cada una `{ id, i18nKey, surface: 'console'|'palette' }`): "Cmd+Shift+V
pega sin smart-paste", "`// @watch x` muestra x en cada cambio", "Arrastra
un CSV al SQL workspace", "Cmd+; repite tu último comando" (cuando RL-113
exista — el catálogo se filtra por features presentes). Render en el empty
state de ConsolePanel y del palette; rotación por sesión (índice =
`sessionSeed % hints.length`, sin `Math.random` en render para
determinismo de tests); "No mostrar tips" → setting `hintsEnabled`.

**AC.** Hint visible en consola vacía; cambia entre sesiones; OFF lo
elimina de ambas superficies; i18n en/es tuteo; cero hints sobre features
no compiladas en la plataforma (web no sugiere Go).

**Cierre 2026-07-15.** `data/hints.ts` define un catálogo cerrado de 20
consejos con selección estable por seed de sesión. La disponibilidad se filtra
antes de calcular el índice modular, por lo que web nunca elige Go nativo ni
plantillas de proyecto que requieren filesystem de escritorio. Consola y Paleta
de comandos comparten `ContextualHint`; “No mostrar consejos” apaga ambas superficies mediante el
setting persistido y saneado `hintsEnabled`, que también puede reactivarse desde
Settings → General. Pruebas focalizadas cubren catálogo, rotación determinista,
filtro de plataforma, stores y ambos renders; el smoke web de producción validó
opt-out y reactivación EN/ES con cero errores de consola. Evidencia visual en
`output/review/d4-d5-d7-discoverability/d7-web-en-console-hint.png`,
`d7-web-en-palette-hint.png` y `d7-web-es-hints-opt-out.png`.

---

## IT2-D8 · Modelo lifetime $59: `pro_lifetime` perpetuo + ventana de updates — IMPLEMENTADO 2026-07-10 · M (security-gated)

**Decisión.** Mantener el precio **$59**, pero pasar del riesgo "updates
forever" (el modelo que quebró el Golden de Bruno) al patrón sostenible:
**licencia perpetua (los entitlements NUNCA caducan) + 12 meses de updates
incluidos + renovación opcional con 30-40% off** para seguir recibiendo
builds nuevas. El monthly `pro` ($5) no cambia.

**Implementación.** El verificador Ed25519 de `src/shared/license.ts`
desacopla la validez de entitlements de la ventana de updates solo para
`pro_lifetime`: ese tier queda siempre `active` tras una firma, payload y
`issuedAt` válidos. El resultado expone `updatesIncludedUntil` y
`updatesLapsed`; este último compara la fecha de build con la ventana de
updates, no el reloj actual. Los tiers temporales conservan sin cambios sus
estados `active` / `grace` / `expired`.

**UX y release.** `__LINGUA_BUILD_DATE__` ya existía en
`build/appBuildMetadata.mts`; main y web lo pasan al verificador. Settings →
License muestra una fila no bloqueante de renovación opcional solo cuando la
build es posterior a la ventana incluida. No corta funciones Pro. El issuer
de Polar ahora sella `pro_lifetime` con 365 días; el dev mint aclara que
`--days` es ventana de updates para ese tier. Website y páginas legales en
inglés/español dicen: acceso Pro perpetuo + 12 meses de updates + renovación
opcional. Los emails de compra y recuperación repiten el mismo contrato y la
fecha concreta de la ventana cuando está disponible.

**Seguridad y regresiones.** La firma se verifica antes de evaluar ventanas;
una modificación del cutoff de updates sigue fallando como
`invalid-signature`. Se estrechó la familia `productId` a `lingua`,
`lingua-*` y `lingua_*`, para que un lookalike como `linguaforeign` no pueda
usar una llave compartida. La revocación/refund del servidor sigue siendo
autoritaria al sincronizar, incluso para un token lifetime fuera de su ventana
de updates.

**Validación.** `tests/shared/license.test.ts` cubre expiry, grace,
perpetual lifetime, build-date y falsificación; `tests/main/license.test.ts`
fija persistencia y revocación desktop; `LicenseSection.test.tsx` cubre la
fila no bloqueante; `license-server/test/webhooks.test.ts` fija el issuer de
365 días y el copy del email de compra; `license-server/test/recover.test.ts`
cubre el email de recuperación; `tests/docs/lifetimePricingContract.test.ts`
evita que vuelva el claim de updates para siempre.

# LANE E — Testeabilidad

## IT2-E1 · Cobertura instrumentada — S (0.5-1 d)
`coverage: { provider: 'v8', reporter: ['text-summary','json-summary'] }`
en la config de vitest; step de CI (job **test** de IT2-B5) que sube el
summary como artifact y lo imprime. SIN umbral bloqueante al inicio;
ratchet después (el umbral solo sube). AC: `pnpm test -- --coverage`
funciona; CI publica el resumen.

## IT2-E2 · Ampliar el gate de type-check de tests — incremental
Hoy `tsconfig.test.json` incluye 1 archivo de 571 (decisión RL-132
documentada: cientos de errores de strictness preexistentes). Plan:
carpeta por carpeta — limpiar `tests/shared/` primero, añadirla al
`include`, PR pequeño; repetir. PROHIBIDO `tests/**` de golpe (AGENTS.md).
AC por PR: la carpeta añadida compila limpia y el gate sigue verde.

## IT2-E3 · Tests del protocolo de workers — S-M (tras IT2-A4)
Con el contrato tipado: tests de request→response shape, `runId` guard
(mensajes de runs viejos descartados — comportamiento RL-078 existente),
timeouts y la variante `bootstrap-progress` (IT2-D3). AC: cada variante del
union tiene al menos un test; `tests/renderer/workers/` deja de ser un gap.

---

# LANE F — Mercado (investigación web 2026-07-06, 4 frentes con fuentes)

## F0 · Mapa competitivo — dónde está parada Lingua

| Competidor | Estado 2026 | Amenaza / oportunidad para Lingua |
| --- | --- | --- |
| **RunJS** (runjs.app) | Activo. v4.0 (abr-2026): logpoints de gutter, runtime por tab, web view, AI chat multi-proveedor. Solo JS/TS. | Amenaza directa en JS/TS. Su maker lanzó **RunPy** (Python separado) — ataca multi-lenguaje con apps mono-lenguaje; Lingua ya lo tiene unificado. Queja recurrente de sus usuarios: renovación anual con pocas updates. |
| **CodeRunner** (macOS) | Vivo, cadencia lenta. $22.99 una vez. 25 lenguajes, debugger 12+ lenguajes, input sets. | Sin notebooks, sin inline results, sin AI, solo macOS. Lingua gana en todo menos en amplitud de debugger. |
| **Quokka.js** | El techo técnico de inline values (Time Machine, Value Explorer, live coverage). Solo JS/TS, vive dentro de VS Code. | No compite por el mismo asiento (extensión vs app), pero define las expectativas de "inline values" de un dev senior. |
| **RunKit** | **Muerto de facto** (caído desde fines de 2024, sin anuncio). | Sus usuarios de notebooks Node+npm están huérfanos — objetivo directo para los notebooks de Lingua + importer. |
| **marimo / Observable 2.0 / Livebook** | Notebooks reactivos en auge; Observable pivotó a local-first/desktop (valida la tesis de Lingua). | **Nadie hace reactividad cross-lenguaje** (marimo = Python+SQL; Polyglot Notebooks comparte datos sin reactividad). Hueco de mercado concreto → IT2-F2. |
| **DevToys / DevUtils / He3** | Utilidades: gratis-OSS / $29 perpetuo / gratis. Feature más citado: smart detection del clipboard. | Compiten con las 30 utilidades, no con el runner. Lingua diferencia por integración (pipelines, capsules, runner al lado). |
| **Bruno / Yaak / Hoppscotch** | Capturaron la migración post-Insomnia. Criterios del comprador: colecciones plain-text en git, offline, scripting+tests, WS/SSE, CLI. | El workspace HTTP de Lingua está por detrás del estándar 2026 en assertions y protocolos realtime → IT2-F8/F9. |
| **DuckDB Local UI** | Gratis, local; Column Explorer (profiling por columna) + notebook SQL con autocomplete. | Mismo motor que Lingua (DuckDB). El profiling por columna es el feature más amado de exploración local → IT2-F3. |

No se encontró evidencia de ningún runner desktop multi-lenguaje
offline-first nuevo (2025-2026) que replique la tesis de Lingua. La ventana
competitiva está abierta; la constelación RunJS+RunPy es quien más cerca
está de cerrarla.

## F-P · Pricing y posicionamiento (conclusiones accionables)

Benchmarks verificados: CodeRunner $22.99 · DevUtils $29-39 (perpetua +
12 m updates, renovación -40%) · Quokka Pro ~$50 (perpetua + 12 m, -30%) ·
Sublime $99 (3 años updates) · TablePlus $99 (perpetua + 12 m) · Yaak
$79/año o $349 lifetime (gratis uso personal) · Bruno mató su one-time
$19 por insostenible y hoy cobra $72/año · Obsidian: core gratis, ~$25M
ARR con 7 personas monetizando add-ons.

1. **Free tier:** subir de 1→3 tabs (evidencia en IT2-D1). Considerar
   snippets 5→25: el cap de 5 castiga el hábito que más retiene.
2. **Lifetime $59 → DECIDIDO 2026-07-06: se mantiene $59 con el modelo
   sostenible** (perpetua + 12 meses de updates + renovación opcional
   30-40% off, DevUtils/Quokka/TablePlus), NO se sube a $79. Evita el
   "updates forever" que quebró el Golden de Bruno. Spec técnica completa
   en IT2-D8 (mapea sobre `pro_lifetime` + `supportWindowEndsAt`, que ya
   existen en el token). Nota abierta: $5×12 = $60 ≈ $59 canibaliza el
   monthly — el monthly queda como puerta de entrada/trial extendido, no
   como revenue principal.
3. **Marketing local-first literal** — los mensajes que ya convierten en
   el segmento y que Lingua puede afirmar con verdad hoy: *"works
   entirely offline"*, *"your code never leaves your machine"*, *"no
   account required"*. Las anti-features (§8) son features de marketing.
4. **GitHub Student Developer Pack** como canal: GitHub verifica al
   estudiante (costo cero para el vendor); Lingua solo emite licencias
   education con expiry 1 año — el modelo Ed25519 offline ya lo soporta.
   Aplicar cuando haya tracción.
5. **Ángulo contra RunJS:** su queja pública es "pago renovación y recibo
   ~3 updates flojas al año". El CHANGELOG denso de Lingua + What's New
   activo (IT2-D5) es munición directa.

## IT2-F1 · Logpoints de gutter — ejecutar **RL-027 Slice 1.5c** ya

**Presión competitiva.** RunJS v4.0 lo shippeó como headline (abr-2026) y
Quokka/Console Ninja lo normalizaron. El roadmap YA lo tiene planeado
(extensión RL-027 Slice 1.5c, promoción post-RunJS-audit 2026-05-21, AC
firmes en el plan interno; comparte security review con Slice 1.5b). La
acción aquí no es especificar de nuevo — es **subirlo de prioridad**: la
infra de Lingua (inline results + `// @watch` + breakpoint UI del debugger
RL-027) deja el costo en bajo-medio. AC: los del plan interno.

## IT2-F2 · Reactividad lazy cross-lenguaje en notebooks — L (la apuesta)

**Hueco de mercado.** Es el remaining "reactive dataflow" de **RL-043**,
ahora con mecanismo verificado y con evidencia de que nadie lo hace
cross-lenguaje: marimo lo hace solo Python+SQL (grafo por análisis
estático de defs/refs, sin ejecutar); Polyglot Notebooks (.NET) comparte
variables entre lenguajes por copia serializada explícita (`#!set`,
mime-type configurable) pero SIN reactividad. La combinación = primer
notebook reactivo TS+Python+SQL local-first.

**Diseño (3 slices).**

1. **Grafo + stale marking (sin auto-run — el modo lazy de marimo).** Por
   celda, extraer defs/refs con análisis estático: TS → el TS-AST rewriter
   que RL-043 Slice B ya usa para cross-cell vars; Python → módulo `ast`
   ejecutado en el kernel Pyodide persistente (RL-043 Slice F); SQL →
   tablas creadas/referenciadas (parseo de `CREATE TABLE x` / `FROM x`).
   Reglas marimo: una variable global se define en UNA sola celda; ciclos
   = error visible. Al editar una celda, sus descendientes se marcan
   **stale** (badge ámbar en la celda, contador en la toolbar del
   notebook) — NUNCA se re-ejecutan solos. Botón "Run stale" + comando de
   palette. Auto-run reactivo queda como toggle opt-in posterior.
2. **Variable sharing cross-lenguaje explícito (patrón Polyglot).**
   Directiva de celda `// @use python:df` / `# @use ts:config` — copia
   serializada nombrada entre runtimes: JSON para escalares/objetos;
   **Arrow** para dataframes DuckDB↔Python (ambos lo hablan nativo, evita
   el costo JSON que Polyglot asume). La directiva crea la arista en el
   grafo del slice 1 — reactividad cruza lenguajes.
3. **Celda SQL ↔ host (patrón marimo SQL):** el resultado de una celda SQL
   nombrada es una variable consumible desde TS/Python vía `@use`.

**AC.** Editar la celda A marca stale exactamente a sus descendientes
(test del grafo puro, sin UI); ciclo → error legible con las celdas del
ciclo; "Run stale" ejecuta en orden topológico; `@use python:df` en TS
recibe el dataframe (round-trip Arrow con 100k filas < 1 s en test);
notebooks sin directivas se comportan EXACTO igual que hoy (cero
regresión — suite RL-043 verde).

## IT2-F3 · Column Explorer en el SQL workspace — EJECUTADO 2026-07-10

El profiling por columna aterrizó como exploración explícita y local: una
consulta `SELECT` o `WITH … SELECT` exitosa muestra **Profile columns** y
abre un panel lateral con tipo, nulos, cardinalidad aproximada, mínimo,
máximo, promedio y desviación estándar por columna. La operación es lazy;
nunca corre automáticamente ni añade entradas a SQL history o Run Ledger.

**Corrección técnica.** DuckDB perfila una consulta con el prefijo
`SUMMARIZE SELECT …` (o `SUMMARIZE WITH … SELECT`), no con
`SUMMARIZE (<query>)`. El helper rechaza consultas vacías, mutables o con
múltiples sentencias, y conserva el límite global de bytes antes de volver a
ejecutar la consulta de lectura.

**Contrato.** El panel es efímero y se cierra al cambiar de resultado; errores,
timeout y truncation muestran un estado honesto y permiten reintentar. La única
telemetría es `sql.profile_opened` con allowlist vacío: nunca viajan SQL,
schema, columnas o valores. La primera versión no añade histogramas por
columna: eso requeriría consultas adicionales y queda fuera del AC de resumen
fiable.

## IT2-F4 · Smart clipboard → sugerencia de utilidad — EJECUTADO 2026-07-16 · S-M (1-2 d)

**Evidencia.** El feature más citado de DevToys/DevUtils/He3 ("smart
detection"). Lingua ya tiene la mitad: el router de smart-paste RL-110
(`src/renderer/clipboard/` — detectores puros + intent router, shipped
2026-06-14) detecta share-links/capsules/cURL/stack-traces/JSON en el
EDITOR. Y los parsers de las 30 utilidades ya existen
(`utils/developerUtilities.ts`, p. ej. `detectsAsBase64`).

**Diseño.** Nueva familia de detectores en el mismo router: JWT (3
segmentos base64url), base64, JSON, timestamp unix, cron (5-6 campos),
color hex/rgb, UUID. Al pegar en el editor algo que NO es código y
matchea, el toast existente de smart-paste ofrece "Abrir en <utilidad>"
(action de `StatusNotice`) → abre el workspace con el panel correcto y el
input pre-cargado (los paneles ya aceptan `initialInput` vía el hook
IT2-A2). Mismo toggle y bypass Cmd+Shift+V de RL-110.

**AC.** Pegar un JWT en el editor → toast → click → panel JWT con el
token cargado; pegar código JS normal → cero toast (test de precedencia:
los detectores RL-110 existentes ganan); toggle OFF lo apaga todo.

**Estado (2026-07-16): hecho.** Nueva familia `UtilityIntent` en el router
RL-110 (JWT, UUID, color con # obligatorio, epoch 2000-2100, cron con
validación de límites por campo — mata `5 * 60 * 1000` —, Base64 solo si
decodifica a texto legible, JSON estricto ≥60 chars). Corre al final de la
cadena, así los importers existentes siempre ganan. El seed viaja por un
slot one-shot en `utilityHistoryStore` (sesión-only, excluido de
partialize); `useTransformUtilityPanel` lo consume gratis para sus paneles
y los otros cinco usan `usePendingUtilityInput`. El toast reutiliza los
labels del catálogo (Abrir depurador JWT) y la telemetría reporta
`utility-<id>` en `SMART_PASTE_HANDLERS` (shared + update-server). Mismo
toggle y bypass Cmd+Shift+V de RL-110.

**Cierre de AC.** 29 tests de detectores (incluidos los negativos de
aritmética JS, hashes hex y literales sin comillas), router, hook del
toast, store y consumidor one-shot. E2E nuevo
(`tests/e2e/smartPasteUtilities.spec.ts`) con paste REAL vía permisos de
clipboard + Meta/Ctrl+V a través del EditContext de Monaco: JWT → toast →
panel precargado y decodificado; código normal silencioso; ES localizado;
cero errores de consola. Evidencia visual en
`output/review/it2-f4-smart-clipboard/`.

## IT2-F5 · Input sets guardados (stdin + args) — EJECUTADO 2026-07-10 · S (1 d)

**Evidencia.** CodeRunner ("run with arguments & input sets") es el único
con esto y sus usuarios lo destacan. Lingua ya tiene stdin por tab
(F-7 shipped) y panel stdin (`showStdinPanel` en settings).

**Diseño.** En el panel stdin: dropdown "Input set" + guardar/renombrar/
borrar sets nombrados `{ name, stdin, args? }` por tab (persistidos en el
store del editor — campo aditivo). El run usa el set activo; la capsule
lo captura (el campo `input.stdin` de `RunCapsuleV1` ya existe — extender
con `input.setName` opcional, additive al schema v1 como campo omitible).

**AC.** Crear 2 sets, alternar, correr → cada run usa su stdin;
sobrevive reload; la capsule registra el set usado; export/import de
capsule con set → round-trip intacto.

**Cierre 2026-07-10.** El panel Entrada ahora administra hasta 20 sets
nombrados por tab, permite crear, seleccionar, renombrar mediante
"Guardar cambios" y borrar, y sincroniza el stdin y los argumentos del
set activo. La sesión v2 persiste y sanea el estado; cambiar a un lenguaje
sin stdin elimina el payload. `RunCapsuleV1.input` suma `setName` y `args`
opcionales sin cambiar `version: 1`; importar una capsule restaura el
snapshot en un tab inerte y nunca ejecuta automáticamente. Los argumentos
quedan preservados en el set, el contexto y la capsule, sin prometer soporte
`argv` en runners que todavía no lo consumen. Evidencia: tests de store,
sesión/migración, ejecución/capsule/import y smoke web EN/ES con dos sets,
reload y gate de cero errores de consola.

## IT2-F6 · Value Explorer live — M (2-3 d)

**Evidencia.** El feature definitorio de Quokka (Community lo capa a 2
niveles — señal de que es driver de conversión Pro). Lingua ya tiene
scope snapshots (`resultStore` "variable scope",
`variableInspectorSurface` setting, `scope-snapshot` del worker).

**Diseño.** Elevar el inspector actual a treeview expandible-por-demanda:
el worker ya envía `scope-snapshot`; añadir mensaje `expand-value`
(request de children de un path `obj.a.b`, tipado en el contrato IT2-A4)
que el worker responde serializando SOLO ese nivel (lazy, evita
serializar objetos enormes). UI: árbol con copy-value/copy-path por nodo.
Gate: Pro (ya existe `EXECUTION_HISTORY`-style gating; usar el
entitlement `BENCHMARK`-adjacente o el que decida producto — NO crear
entitlement nuevo sin decisión).

**AC.** Objeto anidado de 5 niveles → expandir bajo demanda sin
serializar el árbol completo (assert sobre el tamaño del mensaje); copy
value/path; funciona en JS/TS; Python en slice 2 (vía kernel).

## IT2-F7 · Capsule → HTML autocontenido — EJECUTADO 2026-07-16 · S-M (1-2 d)

**Evidencia.** Quokka monetiza compartir ejecuciones (Codeclip, con
backend). La versión Lingua sin backend: exportar una `RunCapsuleV1` a un
único `.html` con código (resaltado estático), output, metadata de
environment y estilos inline — se comparte por Slack/email/gist y se abre
en cualquier navegador sin app.

**Diseño.** `src/shared/capsuleHtmlExport.ts`: template literal → HTML
con CSS inline (sin JS externo, CSP-friendly); resaltado con el
colorizador estático que el notebook ya usa para celdas inactivas
(RL-043 Slice G). Botón "Export HTML" junto al export existente de
capsules; trust event + redacción ya vienen de la capsule.

**AC.** Capsule → HTML → abre standalone con código coloreado y output;
cero requests externos (verificar con el HTML abierto offline); tamaño
< 500 KB para una capsule típica; el HTML declara la versión del schema.

**Estado (2026-07-16): hecho.** `src/shared/capsuleHtmlExport.ts` construye el
documento puro (CSS inline, cero scripts, contenido escapado, CSP
`default-src 'none'` como backstop, `<meta>` con schema v1 + capsule id,
labels i18n inyectados). El orquestador renderer sanitiza, tokeniza con el
tokenizador estático de Monaco (fallback a texto plano) y guarda vía un
helper genérico extraído del exportador `.linguanb` (diálogo nativo en
desktop, blob en web). Botones: Settings → Cuenta → Run capsules y acción
por fila en el browse overlay. Telemetría `settings-export-html` /
`list-export-html` en ambos allowlists (shared + update-server) y trust
event solo tras un guardado exitoso.

**Cierre de AC.** 11 tests del builder (escape hostil, CSP, sin src/href,
tamaño, filename determinista, duración redondeada) + 4 del orquestador +
4 de superficie. El smoke web de producción exportó en EN y ES, validó el
documento renderizado standalone (código coloreado, stdout, entorno,
schema en footer) y terminó con cero errores de consola. Una capsule
típica pesa ~4.7 KB. Evidencia en
`output/review/it2-f7-capsule-html/` (settings EN/ES, documento EN/ES,
y los .html exportados).

## IT2-F8 · HTTP: assertions + scripting post-request — M (3-4 d)

**Evidencia.** Estándar de la categoría 2026 (Bruno, Hoppscotch con
compat `pm.*`, Yaak). Los imports de Postman que RL-100 ya hace HOY
pierden los tests de las colecciones.

**Diseño.** Slice 1 (assertions declarativas, sin código): lista de
asserts por request `{ target: status|header|jsonPath, op: eq|lt|contains,
value }` con UI tipo tabla + resultados pass/fail en el response panel.
Slice 2 (scripting): post-script JS en el **js-worker existente**
(sandboxed, sin DOM) con API mínima `lingua.response`, `lingua.env.set()`
— y mapear los `pm.test()` básicos del import Postman a asserts
declarativos donde sea posible (best-effort documentado). Persistencia en
`workspaceToolStore` (additive).

**AC.** Request con 3 asserts → pass/fail visible; import de colección
Postman con tests → asserts mapeados o aviso claro de qué se omitió;
scripting corre en worker con timeout (reusa el guard de T6-style);
capsule de HTTP captura los resultados de asserts.

## IT2-F9 · WebSocket + SSE en el workspace HTTP — M-L (4-6 d)

**Evidencia.** Yaak y Hoppscotch los tienen; es el segundo criterio del
comprador post-Insomnia (tras git-friendly). gRPC se descarta por ahora
(el más caro, menor demanda relativa).

**Diseño.** Engine en main process junto al proxy T7 (mismas guardas
SSRF/redaction): canal push tipado `http:stream-event` (nuevo en
`ipcContract.ts` — invoke `connect/send/close` + push de frames). UI:
tipo de request "WebSocket"/"SSE" en el workspace, timeline de mensajes
enviados/recibidos con filtros. Capsule de sesión WS = transcript
redactado (los secrets de `{{env}}` ya se redactan).

**AC.** Conectar a un echo server WS local (fixture en tests e2e), enviar
y recibir; SSE contra endpoint fixture; el guard SSRF de T7 aplica
(conectar a IP privada → bloqueado con el mismo error tipado); timeline
sobrevive cambio de tab.

## IT2-F10 · Quick capture global (tray + hotkey) — M (2-3 d, desktop)

**Evidencia.** SnippetsLab Assistant (menu bar) y DevUtils→launchers son
los drivers de hábito diario de sus categorías.

**Diseño.** Desktop only: `globalShortcut` de Electron (default
Cmd+Shift+L, remapeable en el editor de shortcuts RL-037 existente) +
tray menu → mini-popover "Guardar clipboard como snippet" / "Abrir con
utilidad" (reusa la detección IT2-F4) / "Nuevo scratch". Permiso: cero —
no lee el clipboard hasta que el usuario invoca el hotkey (consistente
con la postura de permisos RL-127).

**AC.** Hotkey con la app en background → popover → guardar snippet →
aparece en la librería; el hotkey es remapeable y liberable; web build:
la superficie no existe (stub honesto).

## IT2-F11 · Runner como servidor MCP local — M (3-4 d, gated)

**Evidencia.** Jupyter shippeó `jupyter_server_mcp`; Yaak expone MCP; los
agentes locales (Claude Code, etc.) son el nuevo consumidor de tooling.
Lingua puede ser el brazo de ejecución multi-lenguaje de cualquier agente
— 100% local, alineado con el AI bridge ADR de RL-031.

**Diseño.** Servidor MCP (stdio o HTTP loopback-only) en el main process,
opt-in en Settings → AI, exponiendo herramientas de solo-ejecución:
`run_code(language, code, stdin?)` → resultado tipado (reusa los runners
y sus timeouts/caps), `list_capsules`, `get_capsule(id)`. NUNCA fs write
ni shell. **Gate: security review previa** (misma vara que el eval del
debugger RL-027) + trust event por invocación.

**AC.** Con el toggle ON, un cliente MCP local lista las tools y ejecuta
`run_code('python', 'print(1+1)')` → `2`; con OFF, el server no escucha;
cada invocación queda en el trust ledger; review de seguridad firmada
antes de exponer superficie.

## IT2-F12 · Coverage gutter JS/TS — M (2-3 d, tier 2)

**Evidencia.** Quokka live coverage (verde/parcial/gris por línea).
Lingua ya instrumenta el AST JS/TS (loop protection, magic comments) —
añadir un contador por línea al instrumentado y pintar decorations Monaco
post-run es incremental. Runtimes nativos: fuera de scope (costo alto).

**AC.** Run → gutter marca líneas ejecutadas/no ejecutadas; overhead de
instrumentación < 10% en el benchmark existente; toggle en Settings
(default OFF).

## IT2-F13 · Snippets como archivos planos git-sync — ESTUDIO (ADR primero)

**Evidencia.** El criterio #1 del comprador local-first post-Insomnia
(Bruno `.bru`, massCode `.md` + frontmatter). Hoy los snippets viven en
localStorage — invisibles para git/backup.

**Por qué estudio y no slice:** toca la arquitectura de storage (¿carpeta
elegida por el usuario vía fs capability? ¿sync bidireccional con el
watcher? ¿conflictos?) y colinda con RL-117 (personal cloud sync,
Research-backed spike) y la anti-feature §A-006. Acción: ADR corto
(formato de archivo, dirección del sync, scope: ¿solo snippets o también
colecciones HTTP?) antes de cualquier código. El mismo ADR decide si las
colecciones HTTP van al disco (criterio Bruno).

## F-X · Descartes razonados (para no re-litigar)

- **Vim mode** (CodeRunner): Lingua YA lo tiene (`monaco-vim` +
  ADR de Vim mode; paridad Vim en celdas de notebook, RL-043 Slice G).
- **Carga de `.env` / env vars** (RunJS): ya cubierto por RL-011/RL-109
  (tiers de env por proyecto, shipped).
- **Web view de output** (RunJS): existe BrowserPreview; el auto-refresh
  es RL-119 (ya planeado).
- **Selector de runtime por tab** (RunJS v4): RL-019 (Done) ya da modos
  de runtime JS/TS; solo cabría pulir la visibilidad del selector.
- **Time Machine** (Quokka): valor altísimo, esfuerzo altísimo — parking
  lot explícito; reevaluar tras IT2-F6/F12.
- **SDK de plugins de terceros** (DevToys): contradice el landmine
  activo ("no describir plugin support como terminado") y el anti-scope;
  los user-scripts como paso de pipeline pueden reevaluarse aparte.
- **gRPC** (Yaak/Hoppscotch): detrás de WS/SSE (IT2-F9) por
  costo/beneficio.
- **Sync en la nube propio**: sigue vetado (anti-feature §A-006);
  IT2-F13 lo bordea con archivos locales + git del usuario.

# LANE G — Cierre v4: arranque, resiliencia, a11y, distribución

> Nota de modelos de datos: la v4 NO extiende el DDL del Run Ledger
> (IT2-C1). Las métricas de boot van a telemetría en buckets (opt-in),
> nunca al ledger — el ledger es del usuario, la telemetría del producto.

## IT2-G1 · Instrumentar el arranque — EJECUTADO 2026-07-10

El renderer ahora registra una secuencia estable de marks/measures desde el
inicio del bootstrap hasta la rehidratación: idioma del sistema, i18n, mount de
React, primer paint y sesión restaurada. El comando de palette **Copy boot
timings** / **Copiar tiempos de arranque** copia un snapshot JSON con duraciones
solamente; no incluye timestamps, rutas, contenido del usuario ni otras fuentes
de PII. La telemetría opt-in emite `app.boot_phase` con `phase` y
`durationBucket` cerrados por allowlist, nunca con la duración exacta.

**Cierre de AC.** Los marks y measures se verifican end-to-end en el build web;
la acción de palette y su confirmación se ejercitan en inglés y español; tests
del renderer y del update server demuestran que el redactor descarta tiempos
exactos y propiedades no permitidas. La evidencia visual y automatizada queda
en `output/review/project-sequence/t05-boot-timings/`.

**Evidencia.** No existe medición por fases del boot: `performance-report.mjs`
solo captura el end-to-end del smoke (`launcherToSmokeReadyMs`,
`performance-report.mjs:422`); cero `performance.mark` en `main.tsx`/`App.tsx`.
Sin esto, G2/G3 no pueden probar su valor.

**Diseño.** `performance.mark`/`measure` en las fases reales del bootstrap
(`main.tsx:44-97`): inicio → `resolveSystemLanguage` resuelto → `initI18n`
hecho → React mount → primer paint de AppLayout → rehidratación completa.
Comando de palette "Copy boot timings" (JSON al clipboard). Telemetría
opt-in `app.boot_phase` con `durationBucket` (allowlist; jamás valores
exactos ni timestamps).

**AC.** Marks visibles en DevTools Performance; el comando copia el JSON;
cero PII (test del redactor sobre el evento nuevo).

## IT2-G2 · Arranque percibido: skeleton + ventana sin bloqueo de licencia — EJECUTADO 2026-07-11

> **Estado actual.** Las entradas desktop y web pintan un shell estático
> theme-aware antes de cargar React y lo reemplazan al montar. En desktop, los
> handlers `license:*` se registran inmediatamente contra una promesa compartida
> mientras `createLicenseRuntime` verifica en paralelo; el store usa el estado
> transitorio `verifying` y cae a Free si el bootstrap falla. El smoke local
> 10/10 midió `launcherToSmokeReadyMs` 1948→1453 ms (-25.4%, una corrida de
> referencia, no benchmark estadístico). Playwright conserva capturas dark/light
> del skeleton y Stagewright valida 27 controles interactivos sin errores de
> consola.

**Evidencia previa.** `index.html` montaba React sobre un `<div id="root">` vacío —
pantalla en blanco hasta el mount (index.html:170-173). En desktop, el main
process **esperaba** `bootCrashReporter` y `createLicenseRuntime` ANTES de
`createWindow()` (`src/main/index.ts:294-306`); `show:false` +
`ready-to-show` ya están bien (L154, L194-196).

**Diseño.** (a) Skeleton estático inline en `index.html`: shell mínimo
(barra superior + bloque editor + statusbar) en CSS puro, theme-aware
leyendo `lingua-settings` de localStorage con un script inline mínimo
(verificar compatibilidad con la CSP del build web ANTES — si la CSP lo
bloquea, skeleton monocromo sin script). React lo reemplaza al montar.
(b) **Paso 0 obligatorio:** mapear qué handlers dependen de
`createLicenseRuntime` (`registerLicenseHandlers(licenseRuntime)`). Si la
dependencia es solo de los handlers `license:*`, crear la ventana primero
y resolver el runtime en paralelo (los stores de licencia del renderer ya
modelan estado pendiente); si hay dependencia dura, dividir: ventana
inmediata + runtime awaited solo por sus handlers.

**AC.** Con G1: el intervalo "proceso → ventana visible" baja
(medir antes/después en el smoke); primer paint web muestra skeleton
< 100 ms en throttling "Fast 3G"; el estado de licencia resuelve async sin
flash de "invalid"; smoke desktop completo verde.

## IT2-G3 · Rehidratación diferida de stores pesados — EVALUADO 2026-07-11 · SIN DIFERIMIENTO

> **Estado actual.** Se corrigió primero el límite de medición de G1: el mark
> `lingua:boot:start` ahora se emite desde el HTML estático, antes de descargar
> y evaluar el entry module, y `bootTimings` adopta ese origen sin duplicarlo.
> En seis corridas intercaladas por variante, con navegador fresco, un notebook
> de 200 celdas (212 KB) y Utility History de 241 KB, las medianas
> `start → first-paint` fueron 221,24 ms vacío, 225,09 ms notebook, 221,64 ms
> historial y 222,25 ms combinados. No se aplicó `skipHydration`: el máximo
> delta mediano aislado fue 3,85 ms y diferir estos stores agregaría una espera
> visible al abrir Notebook/Utilities sin una mejora de boot demostrable.

**Evidencia.** Los 15 stores `persist` rehidratan síncronamente en
import-time; `notebookStore` parsea el payload completo al boot y
`utilityHistoryStore` hasta 256 KB (`utilityHistoryStore.ts:49-80`);
`settingsStore` usa `onRehydrateStorage` (L65) — el patrón ya existe.

**Diseño.** Medir primero con G1 cuáles cuestan. Para los pesados que NO
participan del primer paint (`notebookStore`, `utilityHistoryStore`,
`executionHistory` no persiste): `skipHydration: true` + `rehydrate()`
explícito en `requestIdleCallback` tras el primer paint. `settingsStore`
y `editorStore` quedan síncronos (el shell y el session-restore los
necesitan al mount). UI: si el usuario abre un notebook antes del idle
rehydrate, estado de carga breve (el Suspense de LazyNotebookView ya
existe).

**AC.** Marks de G1 muestran la mejora; suite completa verde sin editar
asserts; abrir notebook inmediatamente tras el boot funciona (test e2e
con notebook persistido grande).

**Cierre de AC.** El gate era medir antes de diferir, no imponer el mecanismo.
Los marks ahora abarcan el tramo que se pretendía evaluar y el experimento con
los caps de producción descartó la optimización. Se conserva la hidratación
actual y, por tanto, la apertura inmediata de notebooks y Utilities no gana una
carrera ni un estado de carga nuevo. Las pruebas de skeleton bloquean el entry
module y demuestran que el mark ya existe antes de React.

## IT2-G4 · Toolchain ausente → guía in-app — S (1 d)

**Evidencia.** Cuando falta el toolchain nativo (Go/Rust/Ruby/Node), el
error va a consola sin guía ni retry (auditoría de resiliencia §4); la
detección tipada ya existe (`goLanguageStore`/`rustLanguageStore` + los
detect de cada runner).

**Diseño.** En el fallo de detección, `pushStatusNotice` tone `warning`
con `actions`: "Cómo instalar Go" → `shell.openExternal` a la sección de
instalación por lenguaje (docs del sitio) + "Reintentar detección" →
re-dispara el detect. Copy es/en (tuteo): *"No encontramos Go en tu
sistema. Instálalo y reintenta — todo lo demás sigue funcionando."*

**AC.** Con PATH sin Go (test de main con env controlado), correr Go →
notice con ambos CTAs; retry tras instalar detecta sin reiniciar la app;
con toolchain presente, cero cambio.

**Estado (2026-07-15): hecho.** Go, Rust, Node y el modo Ruby de sistema
comparten un notice localizado con guía y retry. El retry reutiliza los detect
tipados y actualiza el runner vivo; no requiere reiniciar. El notice usa la
prioridad de onboarding porque el smoke Electron encontró que el toast de
primer snippet podía descartar silenciosamente una recuperación normal. Ruby
`auto` conserva su fallback WASM sin ruido; solo `system` muestra la guía.

**Cierre de AC.** 49 tests focalizados cubren runners, ausencia web, prioridad
frente a onboarding y detección reintentada. El smoke Electron arrancó con un
`PATH` sin Go, verificó ambos CTAs, creó un binario Go controlado durante la
misma sesión y confirmó la detección sin reinicio, con cero errores de consola.
Evidencia visual:
`output/review/it2-g4-g5-resilience/desktop-en-missing-go-guidance.png`.

## IT2-G5 · Indicador offline que celebra — S (0.5-1 d)

**Evidencia.** Producción no tiene ninguna señal de offline (la auditoría
lo confirmó: el manejo es test-only vía `offlineSmoke.ts`); offline-first
ES la razón de ser — hoy es invisible.

**Diseño.** `navigator.onLine` + eventos `online`/`offline` → segmento
discreto en el StatusBar: **"Offline — todo sigue funcionando"** (tono
positivo, no advertencia). Tooltip honesto: qué NO está disponible
(updates, AI remota, descarga de runtimes no cacheados). Desaparece al
volver online, sin toasts. Es marketing de la razón de ser dentro del
producto.

**AC.** DevTools offline → chip aparece con el copy positivo; online →
desaparece; correr JS/TS/Python (cacheado) offline funciona y el chip no
interfiere; i18n es/en.

**Estado (2026-07-15): hecho.** El StatusBar observa `navigator.onLine` con
`useSyncExternalStore` y reacciona a los eventos `online`/`offline` sin duplicar
el estado ni emitir toasts. Offline muestra un segmento verde y enfocable con
copy positivo; el tooltip delimita updates, IA remota y descargas no cacheadas.
También se corrigió el default desktop: el preload expone `darwin`/`win32`/
`linux`, no el valor sintético `desktop` que el seed anterior esperaba.

**Cierre de AC.** El E2E de producción alternó conectividad y comprobó aparición
y desaparición, copy y tooltip en inglés y español, con cero errores de consola.
El smoke Electron offline bloqueó tráfico no-loopback y completó 11 casos, con
JavaScript, TypeScript y Python incluidos. El smoke Stagewright adicional quedó
verde. Evidencia visual:
`output/review/it2-g4-g5-resilience/web-en-offline-status.png` y
`output/review/it2-g4-g5-resilience/web-es-offline-status.png`.

## IT2-G6 · ErrorBoundary regional por workspace — S-M (1 d)

**Evidencia.** Solo existe el boundary de shell (`App.tsx:459`,
`region="shell"`); los workspaces lazy (Notebook/SQL/HTTP/Utilities) solo
tienen `Suspense` — un crash de render en un panel tumba el shell entero
(fallback global) en vez del panel.

**Diseño.** Envolver cada workspace lazy en el `ErrorBoundary` existente
con `region` propia (`notebook`/`sql`/`http`/`utilities`) y un fallback
compacto por panel: mensaje + "Reintentar" (re-mount local por key bump)
+ "Copiar reporte" (la infra de reporte redactado ya existe en el
boundary). El resto de la app sigue viva.

**AC.** Throw simulado dentro del notebook (test de componente) → el
editor y el resto del shell siguen operativos; Reintentar re-monta; el
crash-log registra la región correcta; el boundary de shell sigue
cubriendo lo demás.

**Estado (2026-07-15): hecho.** Notebook, SQL, HTTP y Utilities tienen un
boundary regional alrededor de su `Suspense`. El fallback compacto reutiliza
el reporte redactado, mantiene visibles el shell y las demás pestañas, y
reintenta con un remount local sin limpiar stores. El crash-log conserva la
región mediante entradas compatibles con los timestamps de versiones previas.

**Cierre de AC.** 49 tests focalizados cubren el boundary base, las cuatro
regiones, retry y compatibilidad del crash-log. El E2E de producción provocó un
crash controlado en Notebook, abrió y cerró la paleta mientras el fallback
seguía activo, copió un reporte con `region: notebook` y recuperó el workspace
en inglés y español. La prueba terminó sin errores inesperados de consola y un
smoke limpio separado confirmó el arranque normal. Evidencia visual:
`output/review/it2-g6-g7-product-hardening/g6-web-en-notebook-boundary.png` y
`output/review/it2-g6-g7-product-hardening/g6-web-es-notebook-recovered.png`.

## IT2-G7 · A11y: cierre de gaps concretos — S-M (1-2 d)

**Evidencia (corregida en Fase 1).** Base sólida (focus trap canónico
`ModalShell.tsx:234-266`, 87 call sites de announcer, plurales i18next,
`prefers-reduced-motion`). La afirmación de la auditoría "las filas no
tienen role=treeitem" era FALSA: `FileTreeNode.tsx` ya llevaba
`role="treeitem"` + `aria-level` + `aria-expanded` + `aria-selected` —
la parte (a) quedó cubierta y verificada durante IT2-B2 (el árbol plano
virtualizado conserva esos atributos; `aria-level` transmite la
profundidad sin `role="group"` anidado, patrón ARIA de árbol plano
estándar). Gaps reales restantes: StatusBar sin roles semánticos; axe
cubre ~30% de superficies (`a11y.spec.ts`: editor + Settings + palette +
QuickOpen); `.toLocaleString()` en 7 sitios sin respetar `i18n.language`;
context menus solo por right-click en tabs.

**Diseño.** (a) ~~role=treeitem en filas del árbol~~ HECHO (ya existía;
preservado en IT2-B2); (b) `role="status"` en segmentos informativos del
StatusBar; (c) ampliar `a11y.spec.ts` a Snippets, Developer Utilities,
Recipes, overlays de capsule y Notebook; (d) helper `formatNumber(value)`
ligado a `i18n.language` + reemplazo mecánico de los 7
`.toLocaleString()`; (e) Shift+F10/tecla Menu en tabs (el FileTree ya lo
tiene — replicar patrón).

**AC.** axe verde en las superficies añadidas; VoiceOver anuncia
nivel/estado del árbol; números renderizan formato es con locale es;
`check:i18n` verde.

**Estado (2026-07-15): hecho.** Los segmentos informativos del StatusBar
mantienen sus botones y agregan semántica `status`; solo lint, offline y run
usan anuncios polite, mientras cursor, encoding y Git evitan anuncios
repetitivos. `formatNumber` fija el formato a `en`/`es` de Lingua y reemplaza
las nueve expresiones numéricas sin locale en seis módulos. Shift+F10/Menu en
tabs, `treeitem` del FileTree y los scans de Snippets/Utilities ya estaban
cubiertos y se preservaron sin duplicación.

**Cierre de AC.** 71 tests focalizados cubren StatusBar, el helper y las
superficies consumidoras. El pase E2E ejecutó 32 casos con axe verde para
Notebook, Recipes, Run Capsules browser/import y todas las superficies
previas; también verificó `10,000` en inglés y `10.000` en español, con el gate
compartido de cero errores de consola. Evidencia visual:
`output/review/it2-g6-g7-product-hardening/g7-web-en-notebook-a11y.png` y
`output/review/it2-g6-g7-product-hardening/g7-web-es-number-formatting.png`.

## IT2-G8 · Distribución + comparación pública — M (2-3 d, post-release estable)

**Evidencia.** Distribución = solo GitHub Releases (electron-builder.yml:
dmg/zip + NSIS + AppImage); sin Homebrew/winget/Snap — canales estándar
de la categoría (DevToys/DevUtils/Bruno están en brew). La website no
tiene página de comparación (grep "runjs" en website/ = 0 resultados) ni
usa los deep links `lingua://` como demo.

**Diseño.** (a) Homebrew cask (tap propio `johnny4young/homebrew-lingua`)
+ manifest winget, generados como jobs post-publish del Release workflow;
(b) página `/compare/runjs` en el sitio Astro con la tabla honesta de F0
(SEO: "RunJS alternative" — la queja pública de renovación de RunJS es el
ángulo, sin FUD); (c) botones "Ábrelo en Lingua" (`lingua://snippet?...`)
en los docs del sitio como puente web→app.

**AC.** `brew install --cask lingua` instala y abre; manifest winget
validado; página indexable con JSON-LD y en en/es; los deep links del
sitio abren la app instalada.

## IT2-G9 · CLI: documentar + publicar a npm — APROBADO 2026-07-06 · S-M (1-2 d)

**Evidencia (corregida en Fase 1).** El CLI Slice 1 es sólido (esbuild CJS
35 KiB, exit codes 0-4 testeados con snapshots, cero imports del renderer
con ban de ESLint) pero `private: true` — sin canal de instalación público.
La afirmación de la auditoría "sin documentación" era FALSA:
`docs/CLI_USAGE.md` existe y está en el reading order de `docs/README.md`;
el gap real es solo la publicación. RL-098 remaining ya contempla
`lingua run`, `capsule replay`, completions y "package publish chain".

**Spec (aprobada — publicar a npm).** (a) `docs/CLI_USAGE.md` ya cubre la
documentación (verificar que mencione el canal npm cuando exista). (b) Cadena de
publicación npm **dentro del scope de RL-098** (no inventar ticket): o
bien un `package.json` propio en `dist/cli/` con `bin` público, o extraer
el CLI a un paquete publicable `@lingua/cli` (decidir en el ADR de RL-098;
recomendado el paquete dedicado para no publicar el árbol Electron
completo). Versionado atado a la app (`__LINGUA_CLI_VERSION__` ya se
inyecta). Workflow de release: job `npm publish --provenance` tras el
build, gated por el mismo tag del Release. (c) Sinergia: el CLI es el
complemento natural del workspace HTTP con assertions (IT2-F8 →
`lingua http run` en CI, criterio Bruno/Hoppscotch).

**AC.** `npm install -g @lingua/cli` (o el nombre elegido) instala y
`lingua --version` responde; docs mergeadas; publish reproducible desde CI
con provenance; exit codes 0-4 estables (tests existentes verdes); el
paquete NO arrastra código del renderer (ban de ESLint ya lo garantiza).

# 7. Secuencia recomendada (iteración 2)

Cada slice cierra con: `pnpm test -- --run` · `pnpm exec tsc --noEmit` ·
`pnpm run lint` · `check:i18n` · `check:i18n:copy` + smoke web/desktop si
toca UI (mandato AGENTS.md).

**Fase 1 — Fundaciones técnicas** (el orden importa):

| # | Item | Esfuerzo | Nota |
| - | ---- | -------- | ---- |
| 1 | IT2-A6 + IT2-A7 + IT2-B3 | 1 d | Higiene sin riesgo. |
| 2 | IT2-B4 (medir → fix selectores) | 0.5 d | Perf percibida al tipear. |
| 3 | IT2-B1 (descarte post-truncation T6) | 1 d | Robustez del engine. |
| 4 | IT2-B2 (FileTree virtual) | 1.5 d | Piezas ya existen. |
| 5 | ~~IT2-A1 (split fileSystem.ts)~~ | Hecho 2026-07-10 | Assembly 40 LOC; seis módulos <600 LOC. |
| 6 | IT2-A4 → IT2-E3 (worker contract → tests) | 2-3 d | Prerrequisito de D3, F6, F8. |

**Fase 2 — Datos + quick wins de mercado**:

| # | Item | Esfuerzo | Nota |
| - | ---- | -------- | ---- |
| 7 | IT2-C1 → IT2-C2 (Run Ledger → SQL expuesto) | 4-5 d | La pieza central. |
| 8 | IT2-F3 (Column Explorer SQL) | 1-2 d | El feature más amado de la categoría; SUMMARIZE ya existe. |
| 9 | ~~IT2-F5 (input sets stdin+args)~~ | Hecho 2026-07-10 | Persistencia + capsules + smoke EN/ES. |
| 10 | IT2-F4 (smart clipboard → utilidad) | 1-2 d | Extiende RL-110; paridad DevToys/DevUtils. |

**Fase 3 — UX de retención** (que se enamoren):

| # | Item | Esfuerzo | Nota |
| - | ---- | -------- | ---- |
| 11 | IT2-D3 (bootstrap progress + prefetch) | 2 d | Fricción #1 del primer uso. |
| 12 | IT2-D4 + IT2-D5 + IT2-D7 (descubribilidad) | 2.5 d | Hace visible lo que ya existe. |
| 13 | IT2-D2 (RL-046 sobre el ledger) | 3-4 d | Retención; necesita #7. |
| 14 | ~~IT2-D1 (Free 1→3 tabs)~~ + IT2-D8 (lifetime $59 sostenible) | D1 hecho 2026-07-10 + 2-3 d | IT2-D8 es security-gated (verificador Ed25519). |

**Fase 4 — Diferenciadores de mercado**:

| # | Item | Esfuerzo | Nota |
| - | ---- | -------- | ---- |
| 15 | IT2-F1 (= RL-027 Slice 1.5c logpoints) | según ticket | Presión directa de RunJS v4. |
| 16 | IT2-F7 (capsule → HTML autocontenido) | 1-2 d | Share sin backend; único en la categoría. |
| 17 | IT2-F6 (Value Explorer live) | 2-3 d | Driver de conversión Pro (patrón Quokka). |
| 18 | IT2-F8 (HTTP assertions + scripting) | 3-4 d | Estándar 2026 de la categoría. |
| 19 | IT2-F2 (reactividad cross-lenguaje) | L, por slices | La apuesta: hueco de mercado sin ocupar. |
| 20 | IT2-F9 (WebSocket + SSE) | 4-6 d | Segundo criterio del comprador HTTP. |
| 21 | IT2-F10 (quick capture global) | 2-3 d | Hábito diario; desktop only. |
| 22 | IT2-F11 (servidor MCP local) | 3-4 d | **Gated en security review.** |
| 23 | IT2-F12 (coverage gutter) + IT2-F13 (ADR snippets-as-files) | 2-3 d + ADR | Tier 2 / estudio. |

**Fase 5 — Cierre v4 (LANE G)**:

| # | Item | Esfuerzo | Nota |
| - | ---- | -------- | ---- |
| 24 | IT2-G1 (instrumentar boot) | 1 d | **Hecho 2026-07-10** — habilita medir G2/G3. |
| 25 | IT2-G2 (skeleton + ventana sin bloqueo) | 1-2 d | Primer impacto percibido; paso 0 = mapear dependencia de licencia. |
| 26 | IT2-G3 (rehidratación diferida) | Medido 2026-07-11 | **Cerrado sin diferir** — ≤3,85 ms medianos; el costo no justificó nuevas esperas. |
| 27 | IT2-G4 (toolchain ausente → guía) + IT2-G5 (chip offline) | 1.5-2 d | **Hecho 2026-07-15** — ambas frustraciones ahora son momentos de marca. |
| 28 | IT2-G6 (boundaries regionales) | 1 d | **Hecho 2026-07-15** — un crash de workspace ya no tumba el shell. |
| 29 | IT2-G7 (a11y gaps) | 1-2 d | **Hecho 2026-07-15** — semántica, axe ampliado y números ligados al locale. |
| 30 | IT2-G8 (brew/winget + /compare/runjs) | 2-3 d | Post-release estable. |
| 31 | IT2-G9 (CLI docs + publicar a npm) | 1-2 d + RL-098 | **APROBADO 2026-07-06.** Cadena de publish dentro de RL-098. |

**Interleavables en cualquier fase**: RL-133 → RL-134 → RL-135 (lane audit
existente) e IT2-E1/E2 (coverage + typecheck ratchet).

**Adelantos recomendados**: IT2-G1 junto a la Fase 1 (medir antes de
optimizar); IT2-G7a dentro de IT2-B2 (las filas del árbol se reescriben
una sola vez).

# 8. Anti-scope

Sin cambios vs v1: no quitar el bundling offline-first de runtimes (96 MB
deliberados); no migraciones WASM-first sin CAPABILITY_MATRIX; nada de
backend/nube/cuentas para ledger o achievements; no inventar RL ids; no
marketplace ni social (anti-features §A-004/§A-011); RL-105/RL-118 siguen
detrás del product-center (§5a).

# 9. Anexo — diagnóstico v1 por dimensión

(Se conserva el resumen de la primera pasada como contexto histórico:
funcionalidad ★★★★★, arquitectura ★★★★, mantenibilidad ★★★, perf runtime
★★★★, perf build ★★★, testeabilidad ★★★, datos ★★, UX/retención ★★★,
librerías ★★★★★, innovación ★★★★. Evidencia detallada en el historial de
la sesión de análisis del 2026-07-06. Superado por el scorecard v4 de §10.)

# 10. Scorecard final v4 — las 12 dimensiones

Consolidado de las 4 pasadas (auditoría de código v1, verificación de APIs
v2, mercado v3, cierre v4). Cada fila: veredicto + evidencia + qué lane lo
ataca.

| Dimensión | Nota | Veredicto en una línea | Lane |
| --- | :--: | --- | --- |
| **Funcionalidad** | ★★★★★ | 95 tickets shipped; 6 lenguajes ejecutables + notebooks + SQL/HTTP + 30 utilidades + capsules + licensing offline. La amplitud ya es de talla mundial. | F (profundizar, no ensanchar) |
| **Usabilidad** | ★★★★ | Onboarding <90 s, 100% keyboard-path en los flujos núcleo, focus traps canónicos. Gaps: descubribilidad enterrada y bootstrap mudo. | D3, D4-D7 |
| **Innovación** | ★★★★ | Capsules reproducibles + Trust dashboard + AI local con payload preview: real, pero invisible al mercado. La reactividad cross-lenguaje (F2) es el hueco sin ocupar. | F2, C2, G8 |
| **Originalidad** | ★★★★½ | Único runner multi-lenguaje offline-first unificado (la competencia lo ataca con apps separadas). El ledger consultable con SQL (C2) y la capsule→HTML (F7) no los tiene nadie. | C2, F7 |
| **UX** | ★★★½ | Sólida de base, sin momentos de deleite ni loops de retorno; el gating Free contradice la persona objetivo. | D completo, G4-G5 |
| **Performance** | ★★★★½ | Runtime con virtualización, selectors estrechos y compute worker; G1/G2 miden y desacoplan el arranque, G3 descartó diferir stores por falta de ganancia y P6 sacó los probes síncronos del hilo principal. | B |
| **Arquitectura** | ★★★★½ | IPC y workers por contrato, FS por capabilities y assembly de 40 LOC. Restan el lifecycle duplicado de runners y el sprawl de configs. | A2, A4 |
| **Escalabilidad (datos)** | ★★½ | Todo en localStorage con caps; historial volátil. El Run Ledger (DuckDB+OPFS) es el salto — sin dependencias nuevas. | C1-C2 |
| **Testeabilidad** | ★★★ | 571 tests y CI disciplinado, pero 0 coverage instrumentado, 1/571 type-checkeado y axe en ~30% de superficies. | E, G7c |
| **Simplicidad** | ★★★½ | Patrones consistentes (splits RL-128/129/130, contrato IPC); la rompen dos hooks de 488-533 LOC y el boilerplate de paneles. | A2, A5 |
| **Mantenibilidad** | ★★★★ | Docs vivos + gates fuertes; fileSystem, los diez componentes prioritarios, `useAutoRun` y `useImportPreview` ya se partieron con budgets automatizados. No quedan componentes de 800+ LOC; quedan dos hooks grandes de A5. | A2, A5-A7 |
| **Librerías** | ★★★★★ | React 19 / Vite 8 / TS 6 / Electron 43 / zustand 5 / Tailwind 4 — todo al día; el plugin de Forge fue verificado como dependencia viva del empaquetado desktop. | A6 |

**Los tres multiplicadores** (si solo se hicieran tres cosas): (1)
**IT2-C1/C2 Run Ledger** — convierte datos volátiles en el activo que
alimenta retención, replay y el diferenciador SQL; (2) **IT2-F2
reactividad cross-lenguaje** — ocupa el hueco de mercado que nadie tiene;
(3) **IT2-G2 + IT2-D3 arranque y bootstrap percibidos** — la primera
impresión es donde se decide el enamoramiento.
