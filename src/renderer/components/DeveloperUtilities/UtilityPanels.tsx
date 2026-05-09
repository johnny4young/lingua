import type { ComponentType } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { JsonUtilityPanel } from './panels/JsonUtilityPanel';
import { Base64UtilityPanel } from './panels/Base64UtilityPanel';
import { UrlUtilityPanel } from './panels/UrlUtilityPanel';
import { UrlParserPanel } from './panels/UrlParserPanel';
import { StringCasePanel } from './panels/StringCasePanel';
import { HtmlEntityPanel } from './panels/HtmlEntityPanel';
import { StringInspectorPanel } from './panels/StringInspectorPanel';
import { UuidUtilityPanel } from './panels/UuidUtilityPanel';
import { HashUtilityPanel } from './panels/HashUtilityPanel';
import { TimestampUtilityPanel } from './panels/TimestampUtilityPanel';
import { JwtUtilityPanel } from './panels/JwtUtilityPanel';
import { RegexUtilityPanel } from './panels/RegexUtilityPanel';
import { ColorUtilityPanel } from './panels/ColorUtilityPanel';
import { DiffUtilityPanel } from './panels/DiffUtilityPanel';
import { NumberBaseUtilityPanel } from './panels/NumberBaseUtilityPanel';
import { BeautifyMinifyUtilityPanel } from './panels/BeautifyMinifyUtilityPanel';
import { QrCodePanel } from './panels/QrCodePanel';
import { BackslashEscapePanel } from './panels/BackslashEscapePanel';
import { RandomStringPanel } from './panels/RandomStringPanel';
import { Base64ImagePanel } from './panels/Base64ImagePanel';
import { LoremIpsumPanel } from './panels/LoremIpsumPanel';
import { SvgToCssPanel } from './panels/SvgToCssPanel';
import { CronParserPanel } from './panels/CronParserPanel';
import { HtmlToJsxPanel } from './panels/HtmlToJsxPanel';
import { CurlToCodePanel } from './panels/CurlToCodePanel';
import { YamlJsonPanel } from './panels/YamlJsonPanel';
import { JsonCsvPanel } from './panels/JsonCsvPanel';
import { MarkdownPreviewPanel } from './panels/MarkdownPreviewPanel';
import { SqlFormatterPanel } from './panels/SqlFormatterPanel';

export const DEVELOPER_UTILITY_PANEL_COMPONENTS = {
  'json': JsonUtilityPanel,
  'base64': Base64UtilityPanel,
  'url': UrlUtilityPanel,
  'url-parser': UrlParserPanel,
  'string-case': StringCasePanel,
  'html-entity': HtmlEntityPanel,
  'string-inspector': StringInspectorPanel,
  'uuid': UuidUtilityPanel,
  'hash': HashUtilityPanel,
  'timestamp': TimestampUtilityPanel,
  'jwt': JwtUtilityPanel,
  'regex': RegexUtilityPanel,
  'color': ColorUtilityPanel,
  'diff': DiffUtilityPanel,
  'number-base': NumberBaseUtilityPanel,
  'beautify-minify': BeautifyMinifyUtilityPanel,
  'qr-code': QrCodePanel,
  'backslash-escape': BackslashEscapePanel,
  'random-string': RandomStringPanel,
  'base64-image': Base64ImagePanel,
  'lorem-ipsum': LoremIpsumPanel,
  'svg-to-css': SvgToCssPanel,
  'cron-parser': CronParserPanel,
  'html-to-jsx': HtmlToJsxPanel,
  'curl-to-code': CurlToCodePanel,
  'yaml-json': YamlJsonPanel,
  'json-csv': JsonCsvPanel,
  'markdown-preview': MarkdownPreviewPanel,
  'sql-formatter': SqlFormatterPanel,
} satisfies Record<DeveloperUtilityId, ComponentType>;

export function DeveloperUtilityPanel({ toolId }: { toolId: DeveloperUtilityId }) {
  const Panel = DEVELOPER_UTILITY_PANEL_COMPONENTS[toolId];
  return <Panel />;
}
