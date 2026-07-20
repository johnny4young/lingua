import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVELOPER_UTILITIES } from '../../src/renderer/data/developerUtilities';
import { DEVELOPER_UTILITY_PANEL_COMPONENTS } from '../../src/renderer/components/DeveloperUtilities/UtilityPanelRegistry';

const ROUTER_PATH = resolve(
  __dirname,
  '../../src/renderer/components/DeveloperUtilities/UtilityPanels.tsx'
);

const PANELS_DIR = resolve(
  __dirname,
  '../../src/renderer/components/DeveloperUtilities/panels'
);

describe('DeveloperUtilityPanel registry', () => {
  it('maps every utility catalog id to a panel component', () => {
    const catalogIds = DEVELOPER_UTILITIES.map((utility) => utility.id).sort();
    const registryIds = Object.keys(DEVELOPER_UTILITY_PANEL_COMPONENTS).sort();

    expect(registryIds).toEqual(catalogIds);
  });

  it('keeps the router as a small registry instead of a panel implementation dump', () => {
    const source = readFileSync(ROUTER_PATH, 'utf-8');
    const lineCount = source.split('\n').length;

    expect(lineCount).toBeLessThanOrEqual(180);
    expect(source).not.toContain('useState(');
    expect(source).not.toContain('useEffect(');
    expect(source).not.toContain('useMemo(');
  });

  // implementation (implementation note) — every panel registers an output provider
  // so the global Cmd+Shift+C / Cmd+Alt+R shortcuts cover the full
  // catalog. The static-source check catches a regression where a new
  // panel forgot to wire either registration path without paying the
  // cost of rendering the full panel catalog.
  it('every panel module registers exactly one output provider', () => {
    // implementation — `utility-pipelines` is opt-out: the panel
    // produces a streamed multi-step result table, not a single
    // text output, so the Cmd+Shift+C / Cmd+Alt+R global handlers
    // intentionally bypass it. Documented opt-out so future audits
    // know it's not a regression.
    const OUTPUT_REGISTRATION_OPT_OUT = new Set(['utility-pipelines']);
    const panelFileByCatalogId: Record<string, string> = {
      json: 'JsonUtilityPanel.tsx',
      base64: 'Base64UtilityPanel.tsx',
      url: 'UrlUtilityPanel.tsx',
      'url-parser': 'UrlParserPanel.tsx',
      uuid: 'UuidUtilityPanel.tsx',
      hash: 'HashUtilityPanel.tsx',
      timestamp: 'TimestampUtilityPanel.tsx',
      jwt: 'JwtUtilityPanel.tsx',
      regex: 'RegexUtilityPanel.tsx',
      color: 'ColorUtilityPanel.tsx',
      diff: 'DiffUtilityPanel.tsx',
      'number-base': 'NumberBaseUtilityPanel.tsx',
      'beautify-minify': 'BeautifyMinifyUtilityPanel.tsx',
      'string-case': 'StringCasePanel.tsx',
      'html-entity': 'HtmlEntityPanel.tsx',
      'string-inspector': 'StringInspectorPanel.tsx',
      'qr-code': 'QrCodePanel.tsx',
      'backslash-escape': 'BackslashEscapePanel.tsx',
      'random-string': 'RandomStringPanel.tsx',
      'mock-data': 'MockDataPanel.tsx',
      'base64-image': 'Base64ImagePanel.tsx',
      'lorem-ipsum': 'LoremIpsumPanel.tsx',
      'svg-to-css': 'SvgToCssPanel.tsx',
      'cron-parser': 'CronParserPanel.tsx',
      'html-to-jsx': 'HtmlToJsxPanel.tsx',
      'curl-to-code': 'CurlToCodePanel.tsx',
      'yaml-json': 'YamlJsonPanel.tsx',
      'json-csv': 'JsonCsvPanel.tsx',
      'markdown-preview': 'MarkdownPreviewPanel.tsx',
      'sql-formatter': 'SqlFormatterPanel.tsx',
    };

    for (const utility of DEVELOPER_UTILITIES) {
      if (OUTPUT_REGISTRATION_OPT_OUT.has(utility.id)) continue;
      const fileName = panelFileByCatalogId[utility.id];
      expect(fileName, `${utility.id} missing in test mapping`).toBeDefined();
      const source = readFileSync(resolve(PANELS_DIR, fileName!), 'utf-8');
      const directRegistrations = source.match(/\buseRegisterUtilityOutput\(/g)?.length ?? 0;
      const transformRegistrations = source.match(/\buseTransformUtilityPanel\(/g)?.length ?? 0;
      expect(
        directRegistrations + transformRegistrations,
        `${utility.id} (${fileName}) must register exactly one output provider`
      ).toBe(1);

      if (transformRegistrations === 1) {
        expect(
          source.split('\n').length,
          `${utility.id} (${fileName}) must stay within the A2 45-line budget`
        ).toBeLessThanOrEqual(45);
      }
    }
  });

  // implementation — non-generator panels also wire UtilityToolbar so
  // the ⚡ Apply button and Mod+Shift+A apply descriptor get
  // registered. Generators (random-string, lorem-ipsum) intentionally
  // skip the toolbar.
  it('every non-generator panel renders a UtilityToolbar', () => {
    // implementation — `utility-pipelines` is treated as a generator
    // because the pipeline editor owns its own input surface and
    // doesn't share the ⚡ Apply contract with the rest of the catalog.
    const generators = new Set(['random-string', 'mock-data', 'lorem-ipsum', 'utility-pipelines']);
    const panelFileByCatalogId: Record<string, string> = {
      json: 'JsonUtilityPanel.tsx',
      base64: 'Base64UtilityPanel.tsx',
      url: 'UrlUtilityPanel.tsx',
      'url-parser': 'UrlParserPanel.tsx',
      uuid: 'UuidUtilityPanel.tsx',
      hash: 'HashUtilityPanel.tsx',
      timestamp: 'TimestampUtilityPanel.tsx',
      jwt: 'JwtUtilityPanel.tsx',
      regex: 'RegexUtilityPanel.tsx',
      color: 'ColorUtilityPanel.tsx',
      diff: 'DiffUtilityPanel.tsx',
      'number-base': 'NumberBaseUtilityPanel.tsx',
      'beautify-minify': 'BeautifyMinifyUtilityPanel.tsx',
      'string-case': 'StringCasePanel.tsx',
      'html-entity': 'HtmlEntityPanel.tsx',
      'string-inspector': 'StringInspectorPanel.tsx',
      'qr-code': 'QrCodePanel.tsx',
      'backslash-escape': 'BackslashEscapePanel.tsx',
      'base64-image': 'Base64ImagePanel.tsx',
      'svg-to-css': 'SvgToCssPanel.tsx',
      'cron-parser': 'CronParserPanel.tsx',
      'html-to-jsx': 'HtmlToJsxPanel.tsx',
      'curl-to-code': 'CurlToCodePanel.tsx',
      'yaml-json': 'YamlJsonPanel.tsx',
      'json-csv': 'JsonCsvPanel.tsx',
      'markdown-preview': 'MarkdownPreviewPanel.tsx',
      'sql-formatter': 'SqlFormatterPanel.tsx',
    };

    for (const utility of DEVELOPER_UTILITIES) {
      if (generators.has(utility.id)) continue;
      const fileName = panelFileByCatalogId[utility.id];
      expect(fileName, `${utility.id} missing in toolbar mapping`).toBeDefined();
      const source = readFileSync(resolve(PANELS_DIR, fileName!), 'utf-8');
      expect(
        source.includes('<UtilityToolbar'),
        `${utility.id} (${fileName}) must render <UtilityToolbar>`
      ).toBe(true);
    }
  });
});
