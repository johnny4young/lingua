import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';

/**
 * implementation detail — per-tool lazy panel registry. Each panel is a named
 * export, so the loader resolves through a `.then` that re-exposes it as the
 * `default` Vite/Rollup needs for code-splitting. The result: opening the
 * Developer Utilities workspace no longer loads all 30 panels (and their single-use
 * deps like `qrcode` / `sql-formatter`) at once — each tool's chunk loads the
 * first time it is selected. `UtilityPanels.tsx` provides the `<Suspense>`
 * boundary; `prefetchUtilityPanel` (implementation note) warms a chunk on sidebar hover.
 */
type PanelLoader = () => Promise<{ default: ComponentType }>;

const named =
  <T extends Record<string, ComponentType>>(
    loader: () => Promise<T>,
    name: keyof T & string
  ): PanelLoader =>
  () =>
    // `name` is a known export of the loaded module, but indexing the
    // Record-typed module trips `noUncheckedIndexedAccess`; the cast asserts
    // the named panel component is present at runtime.
    loader().then(module => ({ default: module[name] as ComponentType }));

const PANEL_LOADERS = {
  json: named(() => import('./panels/JsonUtilityPanel'), 'JsonUtilityPanel'),
  base64: named(() => import('./panels/Base64UtilityPanel'), 'Base64UtilityPanel'),
  url: named(() => import('./panels/UrlUtilityPanel'), 'UrlUtilityPanel'),
  'url-parser': named(() => import('./panels/UrlParserPanel'), 'UrlParserPanel'),
  'string-case': named(() => import('./panels/StringCasePanel'), 'StringCasePanel'),
  'html-entity': named(() => import('./panels/HtmlEntityPanel'), 'HtmlEntityPanel'),
  'string-inspector': named(() => import('./panels/StringInspectorPanel'), 'StringInspectorPanel'),
  uuid: named(() => import('./panels/UuidUtilityPanel'), 'UuidUtilityPanel'),
  hash: named(() => import('./panels/HashUtilityPanel'), 'HashUtilityPanel'),
  timestamp: named(() => import('./panels/TimestampUtilityPanel'), 'TimestampUtilityPanel'),
  jwt: named(() => import('./panels/JwtUtilityPanel'), 'JwtUtilityPanel'),
  regex: named(() => import('./panels/RegexUtilityPanel'), 'RegexUtilityPanel'),
  color: named(() => import('./panels/ColorUtilityPanel'), 'ColorUtilityPanel'),
  diff: named(() => import('./panels/DiffUtilityPanel'), 'DiffUtilityPanel'),
  'number-base': named(() => import('./panels/NumberBaseUtilityPanel'), 'NumberBaseUtilityPanel'),
  'beautify-minify': named(
    () => import('./panels/BeautifyMinifyUtilityPanel'),
    'BeautifyMinifyUtilityPanel'
  ),
  'qr-code': named(() => import('./panels/QrCodePanel'), 'QrCodePanel'),
  'backslash-escape': named(() => import('./panels/BackslashEscapePanel'), 'BackslashEscapePanel'),
  'random-string': named(() => import('./panels/RandomStringPanel'), 'RandomStringPanel'),
  'mock-data': named(() => import('./panels/MockDataPanel'), 'MockDataPanel'),
  'base64-image': named(() => import('./panels/Base64ImagePanel'), 'Base64ImagePanel'),
  'lorem-ipsum': named(() => import('./panels/LoremIpsumPanel'), 'LoremIpsumPanel'),
  'svg-to-css': named(() => import('./panels/SvgToCssPanel'), 'SvgToCssPanel'),
  'cron-parser': named(() => import('./panels/CronParserPanel'), 'CronParserPanel'),
  'html-to-jsx': named(() => import('./panels/HtmlToJsxPanel'), 'HtmlToJsxPanel'),
  'curl-to-code': named(() => import('./panels/CurlToCodePanel'), 'CurlToCodePanel'),
  'yaml-json': named(() => import('./panels/YamlJsonPanel'), 'YamlJsonPanel'),
  'json-csv': named(() => import('./panels/JsonCsvPanel'), 'JsonCsvPanel'),
  'markdown-preview': named(() => import('./panels/MarkdownPreviewPanel'), 'MarkdownPreviewPanel'),
  'sql-formatter': named(() => import('./panels/SqlFormatterPanel'), 'SqlFormatterPanel'),
  'utility-pipelines': named(() => import('./UtilityPipelinePanel'), 'UtilityPipelinePanel'),
} satisfies Record<DeveloperUtilityId, PanelLoader>;

export const DEVELOPER_UTILITY_PANEL_COMPONENTS = Object.fromEntries(
  (Object.entries(PANEL_LOADERS) as [DeveloperUtilityId, PanelLoader][]).map(([id, loader]) => [
    id,
    lazy(loader),
  ])
) as Record<DeveloperUtilityId, LazyExoticComponent<ComponentType>>;

/**
 * implementation — warm a tool's chunk ahead of selection (e.g. on sidebar
 * hover/focus) so its `<Suspense>` fallback rarely shows. Idempotent: the
 * dynamic import is cached by the bundler after the first call.
 */
export function prefetchUtilityPanel(toolId: DeveloperUtilityId): void {
  void PANEL_LOADERS[toolId]?.();
}
