import {
  detectsAsAbsoluteUrl,
  detectsAsBackslashEscaped,
  detectsAsBase64,
  detectsAsBeautifiable,
  detectsAsCaseConvertible,
  detectsAsColor,
  detectsAsCron,
  detectsAsCsv,
  detectsAsCurl,
  detectsAsDataUri,
  detectsAsHashable,
  detectsAsHtml,
  detectsAsHtmlEntity,
  detectsAsInspectableText,
  detectsAsJson,
  detectsAsJwt,
  detectsAsMarkdown,
  detectsAsNumber,
  detectsAsRegex,
  detectsAsSql,
  detectsAsSvg,
  detectsAsTimestamp,
  detectsAsUrlEncoded,
  detectsAsUuid,
  detectsAsYaml,
} from '../utils/developerUtilityDetection';
import type { DeveloperUtilityId } from './developerUtilities';

/**
 * Input shape for a utility's Apply eligibility check.
 *
 * Most panels only consume `primary`. Diff and Regex also require
 * `secondary`; pure generators map to `null` in the registry.
 */
interface UtilityDetectInputs {
  primary: string;
  secondary?: string;
}

export type DeveloperUtilityDetector = (inputs: UtilityDetectInputs) => boolean;

/**
 * Detector implementations stay separate from the always-reachable catalog.
 *
 * Utility panels already load lazily, so their Apply eligibility can bring
 * the shared predicates with the selected panel instead of charging every
 * workspace startup. Full analyzers remain in each panel's own lazy graph.
 * The exhaustive record makes a new utility choose its detector or opt out
 * explicitly.
 */
const DEVELOPER_UTILITY_DETECTORS = {
  json: ({ primary }) => detectsAsJson(primary),
  base64: ({ primary }) => detectsAsBase64(primary),
  url: ({ primary }) => detectsAsUrlEncoded(primary),
  'url-parser': ({ primary }) => detectsAsAbsoluteUrl(primary),
  uuid: ({ primary }) => detectsAsUuid(primary),
  hash: ({ primary }) => detectsAsHashable(primary),
  timestamp: ({ primary }) => detectsAsTimestamp(primary),
  jwt: ({ primary }) => detectsAsJwt(primary),
  regex: ({ primary, secondary }) => detectsAsRegex(primary) && (secondary ?? '').length > 0,
  color: ({ primary }) => detectsAsColor(primary),
  diff: ({ primary, secondary }) => primary.length > 0 && (secondary ?? '').length > 0,
  'number-base': ({ primary }) => detectsAsNumber(primary),
  'beautify-minify': ({ primary }) => detectsAsBeautifiable(primary),
  'string-case': ({ primary }) => detectsAsCaseConvertible(primary),
  'html-entity': ({ primary }) => detectsAsHtmlEntity(primary),
  'string-inspector': ({ primary }) => detectsAsInspectableText(primary),
  'qr-code': ({ primary }) => primary.trim().length > 0,
  'backslash-escape': ({ primary }) => detectsAsBackslashEscaped(primary),
  'random-string': null,
  'mock-data': null,
  'base64-image': ({ primary }) => detectsAsDataUri(primary),
  'lorem-ipsum': null,
  'svg-to-css': ({ primary }) => detectsAsSvg(primary),
  'cron-parser': ({ primary }) => detectsAsCron(primary),
  'html-to-jsx': ({ primary }) => detectsAsHtml(primary),
  'curl-to-code': ({ primary }) => detectsAsCurl(primary),
  'yaml-json': ({ primary }) => detectsAsJson(primary) || detectsAsYaml(primary),
  'json-csv': ({ primary }) => detectsAsJson(primary) || detectsAsCsv(primary),
  'markdown-preview': ({ primary }) => detectsAsMarkdown(primary),
  'sql-formatter': ({ primary }) => detectsAsSql(primary),
  'utility-pipelines': null,
} satisfies Record<DeveloperUtilityId, DeveloperUtilityDetector | null>;

export function findDeveloperUtilityDetector(
  id: DeveloperUtilityId
): DeveloperUtilityDetector | null {
  return DEVELOPER_UTILITY_DETECTORS[id] ?? null;
}
