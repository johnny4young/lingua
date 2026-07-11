# Lingua — Plan de implementación H2 2026

> **Propósito.** Este documento es el contrato de trabajo para el agente
> implementador. Consolida (a) el estado real tras los seis PRs de la
> revisión profunda de julio 2026, (b) el plan de merges con sus
> conflictos conocidos, y (c) el backlog priorizado de features y
> re-arquitectura, cada ítem con diseño, slices, criterios de aceptación
> y modo de validación. Complementa — no reemplaza — a
> `docs/DEEP_REVIEW_2026_07.md` (análisis y hallazgos) y al informe de
> auditoría de `.audit/` (PR #17).
>
> **Regla de oro para el implementador:** un ítem = una rama = un PR.
> Antes de declarar un slice terminado: `pnpm test -- --run`,
> `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run check:i18n`,
> `pnpm run check:i18n:copy`, `node scripts/changelog-check.mjs`, y la
> verificación de UI obligatoria de AGENTS.md cuando el diff toque
> superficie de usuario. Las minas documentadas en AGENTS.md aplican
> todas (heading `## [0.9.0]` del CHANGELOG, guard de copy del renderer,
> tuteo neutro en ES, sin atribución de IA en commits).

## 0. Actualización operativa — 2026-07-11

Las secciones 1–2 se conservan como snapshot histórico de la ronda PR #17–#22;
ya no describen PRs abiertos ni un merge train pendiente. Para estado operativo
actual, `docs/IMPROVEMENT_PLAN_2026-07.md` gana sobre estimaciones antiguas de
este documento y `docs/DEEP_REVIEW_2026_07.md` mantiene el inventario de
hallazgos.

La ronda actual completó: Column Explorer, B13 (watcher fresh-state), Input
Sets, Free 1→3 tabs, instrumentación de boot G1, hardening B5 de npm en Windows,
P3/P4/P7 de rendimiento, el split final IT2-A1 de filesystem y los cuatro
componentes prioritarios de A5. IT2-G2 añadió el skeleton de primer paint y
sacó la inicialización de licencia del camino crítico de la ventana desktop.
B5 cuenta además con evidencia nativa del job Windows del PR; P6 y los seis
componentes renderer que aún superan 800 LOC siguen abiertos. Evidencia
reproducible: `output/review/project-sequence/t01-*` … `t08-*` y
`output/review/g2-perceived-boot/`.

Siguiente secuencia recomendada: G3 (rehidratación diferida guiada por los
timings de G1/G2), P6 (`fs/promises` en probes síncronos) y luego los seis
componentes restantes de A5. No abrir otra expansión de superficie antes de
medir G3.

---

## 1. Snapshot histórico previo a la ronda actual

### 1.1 PRs que estaban abiertos en ese snapshot

| PR | Rama | Contenido | Riesgo de conflicto |
|----|------|-----------|---------------------|
| #17 | `claude/lingua-full-spectrum-audit-hb7fah` | Auditoría full-spectrum (solo docs, `.audit/`) | Nulo |
| #18 | `claude/project-deep-review-qmcxx1` | Remediación deep-review: sandbox git por archivo, HTTPS obligatorio en license server, env de runners endurecido, 10+ bugs (notebook re-run, watcher async, LSP duplicado, cancel de dependencias, licencia web, editor), Monaco fuera del boot, informe `docs/DEEP_REVIEW_2026_07.md` | Notebook (bloquea T5/T6), CHANGELOG |
| #19 | `claude/typed-ipc-contract` | Contrato IPC tipado (`src/shared/ipcContract.ts` + `typedInvoke`/`typedHandle`), 82 casts eliminados, test de drift | `src/preload`, `src/main/ipc/*`, CHANGELOG |
| #20 | `claude/build-env-consolidation` | Cascada de env compartida (`build/resolveEnv.mts`) + gate CI anti-drift de defines | `vite.main.config.mts`, CHANGELOG |
| #21 | `claude/workspace-improvements-p1` | Bugs P1: fuga de API key en cápsulas HTTP, params deshabilitados, cancel + carrera de ejecución HTTP, auto-refresh de esquema SQL, copy WYSIWYG, markdown debounced en notebook | `SqlWorkspacePanel`, `SqlResultPreview`, `workspaceToolStore`, CHANGELOG |
| #22 | `claude/workspace-improvements-p2` | Features P2: HTTP "Copy as…" (fetch/axios/requests) + SQL autocompletado de columnas con browser expandible (`information_schema.columns` en 1 viaje) | `SqlWorkspacePanel.handleRefreshTables` choca con #21, CHANGELOG |

### 1.2 Diferido con causa (no son pendientes silenciosos)

- **Proxy HTTP en proceso main (bypass CORS)** — necesita smoke de app
  empaquetada en hardware real. Diseño completo en T7 de este documento.
- **Celdas SQL en notebook / estado Python entre celdas** — solapan la
  reescritura de notebook del PR #18; implementar SOLO después de su
  merge. Diseño en T5/T6.
- **Exportar resultado SQL a archivo** — chocaba con el rewrite de
  `SqlResultPreview` del PR #21; implementar tras el merge. Diseño en T1.
- **Fix de re-render de `EditorTabs` (igualdad Zustand v5)** — requiere
  reestructurar el selector, no un parche con `useShallow`. Diseño en T4.
- **Retirar `ViteConfigGenerator` de Forge en `build-desktop-bundles.mjs`**
  — seguimiento de A2 (PR #20); requiere smoke empaquetado.
- **Interleaving stdout/stderr del kernel de notebook y semántica de
  reasignación** — dentro del área congelada por PR #18.

---

## 2. Plan de merges histórico (completado)

Orden recomendado y resolución de los conflictos conocidos:

1. **#17** (solo docs) → merge directo.
2. **#18** (deep review) → merge directo. Desbloquea T5/T6.
3. **#19** (IPC tipado) → rebase sobre main post-#18 (tocan ambos
   `src/main`); los conflictos esperables son de imports y CHANGELOG.
4. **#20** (env cascade) → rebase; conflicto solo en CHANGELOG.
5. **#21** (P1 workspaces) → rebase; conflicto en CHANGELOG y quizá en
   los mismos ficheros de notebook que #18 tocó (el debounce de
   markdown es aditivo; conservar ambos lados).
6. **#22** (P2 workspaces) → rebase sobre main post-#21. **Conflicto
   real esperado en `SqlWorkspacePanel.tsx`:**
   - `handleRefreshTables`: #21 añade auto-refresh al montar y tras DDL
     (`refreshTablesRef` + `queryChangesSchema`); #22 reescribe el
     cuerpo de la introspección (probe único `information_schema.columns`).
     Resolución: conservar la ESTRUCTURA de #21 (ref + efectos) con el
     CUERPO de #22 (probe único). Son ortogonales.
   - `isExecutingActive` → `executingRequestId` (#21) no toca SQL; sin
     interacción.
   - CHANGELOG: concatenar ambas viñetas bajo `### Added` / `### Fixed`
     de `[Unreleased]`, preservando el heading `## [0.9.0] — 2026-06-28`.

Tras cada merge: correr la suite completa en main antes del siguiente.

---

## 3. Backlog priorizado

Convenciones: **S** < 1 día, **M** 1–3 días, **L** > 3 días de agente.
"Validación web" = smoke con `pnpm run preview:web` según AGENTS.md.
"Validación desktop" = requiere `pnpm run make:desktop` + smoke en
hardware; si el entorno no puede, dejar el PR en draft con la
instrucción de smoke escrita en el cuerpo.

### Tier 1 — Post-merge inmediato (S/M, todo validable en web)

#### T1. SQL: exportar resultado a archivo (CSV / JSON / Markdown) — S

- **Problema.** Hoy solo hay copy al portapapeles; un resultado de miles
  de filas no cabe en un paste razonable y el flujo natural es "guardar
  como archivo".
- **Diseño.** En `SqlResultPreview.tsx`, junto a los tres `CopyButton`
  existentes, un botón "Exportar…" con menú (mismo patrón `role="menu"`
  que el "Copy as…" de HTTP en #22 — reutilizar la técnica de
  outside-click/Escape). Cada opción serializa con los formatters ya
  existentes (`rowsToCsv`, `rowsToMarkdownTable`, `JSON.stringify`) y
  descarga vía `Blob` + `URL.createObjectURL` + `<a download>` efímero.
  Nombre de archivo: `<queryName || 'result'>-<yyyyMMdd-HHmm>.<ext>`
  saneado (sin caracteres de path).
- **Decisión WYSIWYG.** Igual que el copy post-#21: exportar
  `displayRows` (filtrado+ordenado). Si `response.tooLarge`, la notice
  de éxito debe divulgar que se exportó la vista previa truncada
  (reutilizar el patrón `copyNoticeFor`/`COPY_PREVIEW_SUCCESS_KEYS`).
- **i18n.** `sqlWorkspace.action.export`, `.exportAsCsv`, `.exportAsJson`,
  `.exportAsMarkdown`, `.exportSuccess`, `.exportPreviewSuccess` en EN+ES.
- **Aceptación.** Test de componente: click en export-CSV genera un Blob
  cuyo texto coincide con `rowsToCsv(displayRows)`; con filtro activo
  exporta solo filas filtradas. Gates + smoke web (bajar un CSV real).

#### T2. HTTP: capturar variables de la respuesta (encadenamiento) — M

- **Problema.** El workspace HTTP no permite alimentar la respuesta de
  una request en la siguiente (login → token → llamada autenticada), el
  caso de uso nº1 de cualquier cliente HTTP serio.
- **Diseño.**
  - `src/shared/httpWorkspace.ts`: nuevo tipo
    `HttpCaptureRule { id, source: 'body-json' | 'header' | 'status', path, targetVariable, enabled }`
    en `HttpRequestV1` (campo opcional `captures?: HttpCaptureRule[]` —
    versionar el parser/serializer existente igual que se hizo con
    `auth`).
  - Extractor puro `extractCaptureValue(response, rule): string | null`
    en shared: para `body-json` un path estilo `data.token` o
    `items[0].id` (implementar un walker propio de ~30 líneas; NO traer
    dependencia jsonpath); para `header`, lookup case-insensitive.
  - En el settle exitoso de `handleSend` (HttpWorkspacePanel), aplicar
    las reglas y escribir en el environment ACTIVO vía la acción de
    store existente para variables. Si la variable destino está marcada
    secreta, el valor capturado hereda la secrecía (y por tanto la
    redacción en cápsulas ya cubierta por #21).
  - UI: pestaña "Capture" junto a Params/Headers/Body/Auth con filas
    editables (mismo componente de fila que Params). Badge con el
    conteo de capturas activas.
- **Cuidados.** No capturar sobre respuestas `tooLarge` truncadas sin
  avisar (notice de warning). No ejecutar capturas si la request fue
  cancelada (respetar el guard `controller.signal.aborted` de #21).
- **Aceptación.** Tests: extractor (paths anidados, array index, header
  case-insensitive, miss → null), integración captura→variable→
  interpolación en la siguiente request, secrecía heredada. Smoke web
  con httpbin o el eco local del preview.

#### T3. Notebook: rich outputs (tabla + imagen) en celdas — M

- **Problema.** `src/shared/richOutput.ts` ya reserva los variants
  `table` / `image` / `chart` (los stubs "Slice 2" del propio archivo)
  y la consola ya renderiza rich outputs; las celdas de notebook siguen
  mostrando texto plano.
- **Diseño.** Reutilizar el dispatcher de rich output de la consola
  dentro de `NotebookCodeCellRow` (extraer el renderer a un componente
  compartido `RichOutputView` si aún vive acoplado a ConsolePanel).
  Para Python (Pyodide): detectar `pandas.DataFrame` (→ variant `table`
  con cap de filas) y `matplotlib` figure (→ `image` PNG base64) en el
  serializador del worker — el TODO del archivo ya nombra exactamente
  estos dos. Para JS/TS: arrays de objetos homogéneos → `table` (la
  heurística ya existe para la consola).
- **Dependencia.** Post-merge #18 (reescribe notebook).
- **Aceptación.** Tests del serializador (DataFrame→table, figure→image,
  degradación a texto), test de componente del render en celda, smoke
  web con una celda Python que produzca un DataFrame.

#### T4. Perf: `EditorTabs` deja de re-renderizar en cada cambio global — EJECUTADO 2026-07-10

> **Estado actual.** P3 quedó cerrado con una proyección de metadata visible
> codificada como strings value-equal bajo `useShallow`; el buffer completo no
> llega a la tira ni a sus rows memoizados. El primer cambio puede actualizar
> `isDirty`; las pulsaciones posteriores con metadata estable producen cero
> commits en parent y rows. El test de Profiler y la evidencia de T07 reemplazan
> el diseño hipotético de ids-only descrito abajo.

- **Problema.** El selector de `EditorTabs` (840 líneas) reconstruye un
  array de objetos por render, y con la igualdad estricta de Zustand v5
  cada mutación del store re-renderiza toda la strip. Diferido de P3
  porque `useShallow` no basta cuando los objetos se recrean.
- **Diseño.** Dos movimientos: (1) el componente lista suscribe SOLO a
  `state.tabs.map(t => t.id).join('\0')` + `activeTabId` (string
  primitivo → igualdad estricta funciona); (2) cada `<EditorTab>` hijo
  se suscribe a SU tab por id
  (`useEditorStore(useCallback(s => s.tabs.find(t => t.id === id), [id]))`)
  y se envuelve en `memo`. El drag-reorder sigue funcionando porque el
  orden vive en el string de ids.
- **Aceptación.** Test con contador de renders (patrón ya usado en el
  repo para las filas de notebook): editar el contenido de un tab NO
  re-renderiza los otros tabs. Smoke web de la strip (crear/cerrar/
  reordenar).

#### T5. Test flaky `UtilityPipelinePanel` — S

- **Problema.** 1 fallo intermitente solo en suite completa (pasa 18/18
  aislado). Ruido que erosiona la confianza en el gate.
- **Diseño.** Diagnóstico primero: correr con `--sequence.seed` fijo y
  `--reporter=verbose` para identificar el test contaminante previo
  (sospecha: timers fake no restaurados o store no reseteado entre
  archivos). Arreglar la CAUSA (cleanup en el archivo contaminante), no
  poner retry.
- **Aceptación.** 20 corridas consecutivas de la suite completa sin
  fallo (script de loop en CI local).

### Tier 2 — Re-arquitectura (M, retorno estructural)

#### T6. Unificar runners nativos: `spawnNativeRun` + `detectToolchain` — M

- **Problema.** `node-runner.ts` (892), `ruby-runner.ts` (547),
  `go-compiler.ts` (270), `rust-compiler.ts` (290) repiten spawn sin
  shell, timeout SIGTERM→SIGKILL, cap de output, env allowlist
  (`nativeEnv.ts`), kill de árbol (`processTree.ts`) y detección de
  toolchain con caché. Es el ítem A4 del deep review: −600/800 líneas y
  el runner nº5 cuesta un tercio.
- **Diseño.** `src/main/runners/spawnNativeRun.ts`:
  `spawnNativeRun({ command, args, cwd, env, timeoutMs, maxOutputBytes, onStdout?, onStderr?, signal? }): Promise<NativeRunResult>`
  — absorbe spawn, caps, timeout, kill de árbol y clasificación de
  salida. `src/main/runners/detectToolchain.ts`: sondeo con caché por
  sesión (ya existe ad-hoc para go/rust tras el deep review — moverlo
  aquí). Migrar los cuatro runners UNO POR PR-commit, cada uno con sus
  tests existentes en verde antes del siguiente. No cambiar ningún
  mensaje de error visible (los tests de i18n de errores lo vigilan).
- **Ceilings de recursos (auditoría B-4) en el mismo seam:** una vez
  centralizado el spawn, añadir `--max-old-space-size` para Node y
  `ulimit`-style vía `prlimit` en Linux (best-effort, no-op donde no
  exista). Documentar en `CAPABILITY_MATRIX.md`.
- **Validación.** Desktop: `pnpm run smoke:desktop` (matriz JS/TS/Go/
  Rust). Si el entorno no puede, PR en draft con la instrucción.

#### T7. Proxy HTTP en proceso main (bypass CORS, desktop) — L

- **Problema.** En web, `fetch` del renderer está sujeto a CORS; media
  internet es inalcanzable desde el workspace HTTP. En desktop no hay
  razón para esa limitación — todos los clientes HTTP nativos la evitan.
- **Diseño.**
  - **Contrato:** canal `http:execute` en `src/shared/ipcContract.ts`
    (aprovechar #19): args = la request YA interpolada y compuesta
    (la interpolación de secretos NUNCA cruza a main como plantilla;
    main recibe los bytes finales igual que hoy los recibe `fetch`);
    result = `HttpResponseV1` serializable.
  - **Main:** handler con Node `fetch` (undici) espejando el envelope
    de `httpClient.ts`: timeout por `AbortController` (mismos límites),
    streaming con cap `MAX_RESPONSE_BODY_BYTES`, y clasificación
    `network-error`/`timeout` (en main no existe `cors-error`).
  - **SSRF:** resolver el hostname ANTES de conectar y rechazar por
    defecto destinos loopback/link-local/RFC1918 salvo opt-in explícito
    en Settings → Privacy ("Permitir hosts privados en HTTP workspace",
    default off, evento de trust capturado como los demás). Bloquear
    esquemas ≠ http/https. Cap de redirects (5) re-validando cada salto.
  - **Renderer:** `httpClient.ts` gana un seam
    `transport: 'browser-fetch' | 'main-proxy'`; desktop usa proxy por
    defecto con toggle en Settings; web mantiene `browser-fetch`.
    `CAPABILITY_MATRIX.md` gana la fila (clase "desktop nativo").
  - **Redacción:** la respuesta que vuelve de main pasa por el MISMO
    camino de redacción/cápsula del renderer que hoy — cero cambios en
    la superficie de privacidad.
- **Slices:** (1) contrato+handler+tests main; (2) seam de transporte +
  toggle + matriz; (3) smoke desktop empaquetado.
- **Validación.** Desktop empaquetado obligatorio (el gate del env de
  #20 no cubre runtime). PR en draft si no hay hardware.

#### T8. Split de componentes 800+ — EJECUTADO PARCIAL 2026-07-10

> **Estado actual.** Se partieron los cuatro prioritarios confirmados por la
> ronda: `NotebookView` 1238→756 LOC, `SqlResultPreview` 1018→675,
> `CommandPalette` 987→143 y `EditorTabs` 1007→267. El inventario bajó de 10
> a 6 componentes sobre 800 LOC y un test estructural fija el budget. Restan
> `HttpRequestEditor`, `EditorSection`, `UtilityPipelinePanel`, `SettingsModal`,
> `ConsolePanel` y `SqlWorkspacePanel`; no se marcan como hechos.

- **Objetivo.** Diffs revisables; ningún cambio de comportamiento.
- **Orden por retorno:** `NotebookView` (1238 — post-#18),
  `EditorSection` (929), `FloatingActionPill` (927), `AppLayout` (897),
  `UtilityPipelinePanel` (892 — de paso arregla T5 si el flaky vive en
  su tamaño), `HttpRequestEditor` (868 — post-#22).
- **Patrón.** Extraer subcomponentes por región visual + hooks por
  dominio (el repo ya lo hizo con `editor*Actions.ts` para el
  editorStore — espejo de ese estándar). Un componente por PR; el test
  existente del padre debe pasar SIN editar aserciones (solo imports).

#### T9. Descomponer `notebookStore` (patrón RL-128) — M

- Post-#18. Último "god store" según el deep review. Separar en
  `notebookCellActions` / `notebookPersistence` / `notebookSelectors`
  espejando cómo `editorStore` quedó dividido (ver
  `src/renderer/stores/editor*` como plantilla). Sin cambio de API
  pública del hook.

#### T10. Reconciliar el modelo de tiers de licencia (4 vs 6) — M

- **Problema.** Documentado en #19: `src/shared/license.ts` es la fuente
  canónica con 6 tiers (incluye `trial`/`education`), pero los tipos
  ambient del renderer (`src/types.d.ts`) solo conocen 4; por eso los
  handlers `license:*` quedaron FUERA de `typedHandle` con un NOTE.
- **Diseño.** Migrar el renderer al tipo compartido de 6 tiers (los dos
  extra se comportan como `pro` en `useEntitlement` salvo donde Settings
  ya distinga), borrar los tipos ambient duplicados, y envolver los
  handlers `license:*` en `typedHandle` cerrando la excepción del
  contrato. NO tocar la verificación Ed25519 ni el orden de validación
  (regla dura de la auditoría).
- **Aceptación.** El NOTE de #19 se elimina; el test de drift del
  contrato cubre `license:*` por tipo y no solo por nombre.

### Tier 3 — Seguridad y build (S/M, de la auditoría PR #17)

| Ítem | Diseño en una línea | Validación |
|------|---------------------|------------|
| T11. CSP `connect-src` (B-2) | Sustituir `https: wss:` por la allowlist real (license server, updater, telemetría) + `http://localhost:*` solo en dev; el HTTP workspace web YA depende de fetch a cualquier origen → gate del cambio detrás del transporte T7 o documentar la excepción como decisión de producto | Smoke web: licencia + HTTP workspace siguen funcionando |
| T12. Binding de `productId` (B-3) | En la verificación del token, exigir `productId === 'lingua'` además de la forma; test con token de otro producto firmado por la misma clave → rechazado | Tests de licencia |
| T13. Dedupe de payloads TS del bundle web (C-1) | Los chunks `typescript-*.js` (885 KB + 3.4 MB) duplican el compilador; unificar el import de Monaco TS worker y el del runtime de transpilación en un único chunk compartido vía `manualChunks` | `pnpm run performance:report` + budget |
| T14. `.env.production` trackeado (B-9) | Decisión de dueño: si se mantiene, añadir comentario-contrato de "solo material público" + check en CI de que no aparezcan claves privadas | CI |
| T15. Pin de `@electron/node-gyp` (D-2) | Sustituir el tarball de GitHub por versión de registro cuando exista; si no, vendorizar el hash y re-activar `blockExoticSubdeps` | Install limpio + CI |

### Tier 4 — Features estratégicas (L, decisión de producto previa)

Estas cuatro vienen del Top-10 del deep review; cada una merece su
propio documento de diseño ANTES de codificar. Orden sugerido por
retorno/riesgo:

1. **T16. Celdas SQL (y JS) en notebooks** — el runtime DuckDB y el
   worker JS ya existen; es cablear `cellKind: 'sql'` al
   `notebookSession` + salida como rich-output `table` (sinergia con
   T3). Esfuerzo el más bajo del tier. Post-#18 + T3.
2. **T17. Estado Python entre celdas** — instancia Pyodide única por
   notebook con namespace persistente (dict global por sesión de
   notebook, invalidado en "Restart kernel"). Definir la semántica de
   reasignación JUNTO con el ítem congelado de #18.
3. **T18. Debugger de Python (RL-027 Slice 2)** — puente `pdb` headless
   por IPC sobre el contrato de #19; desktop nativo.
4. **T19. IA local/híbrida (RL-031)** — el entitlement `LOCAL_AI` ya
   está reservado; empezar por "Explica este error" con BYO-API-key
   (menor superficie), y evaluar transformers.js/Ollama después.
   Requiere decisión de producto sobre privacidad/red antes de escribir
   código (el principio "no silent network call" es marca).

---

## 4. Orden de ejecución recomendado

```
Fase 0  Merges #17→#18→#19→#20→#21→#22 (sección 2)          [bloquea todo]
Fase 1  T1 → T5 → T4 → T2 → T3                               [web, S/M]
Fase 2  T10 → T6 → T8 (2-3 splits) → T9                      [estructura]
Fase 3  T12 → T14 → T13 → T15 → T11                          [auditoría]
Fase 4  T7 (proxy HTTP)                                      [desktop]
Fase 5  T16 → T17 → (decisión producto) → T18 / T19          [estrategia]
```

Racional: la Fase 1 entrega valor de usuario inmediato con validación
web completa; la Fase 2 abarata todo lo posterior; la Fase 3 son cierres
de auditoría acotados; las Fases 4–5 son las únicas que exigen hardware
o decisión de producto y por eso van al final aunque su impacto sea el
mayor.

## 5. Definición de terminado (por ítem)

1. Gates verdes (los seis de la regla de oro).
2. Verificación de UI del nivel que corresponda (web smoke por defecto;
   desktop cuando el diff sea main-only; nunca omitir ambos).
3. CHANGELOG bajo `[Unreleased]` si el cambio es visible al usuario.
4. Tests nuevos que cubran el comportamiento nuevo Y la regresión que
   motivó el ítem (cuando aplique).
5. Docs actualizadas en el mismo PR si el cambio toca atajos, ejecución
   o workflow (mina de AGENTS.md).
6. PR con el template del repo; en draft solo si falta el smoke de
   hardware, con la instrucción de smoke escrita en el cuerpo.
