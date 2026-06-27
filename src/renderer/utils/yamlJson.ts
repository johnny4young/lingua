/**
 * RL-068 — YAML ↔ JSON converter helper.
 *
 * Pure, offline, renderer-side. `js-yaml@^4` is already a prod dep
 * (used by `src/renderer/validation/index.ts`); no bundle delta from
 * this slice.
 *
 * Both directions return a tagged-union so the panel can surface
 * translated errors without try/catch at the call site. The forward
 * direction (YAML → JSON) also reports `hadComments` because js-yaml
 * v4 does not preserve comments — the panel renders an explicit
 * "comments were dropped" notice when the input contains any `#`-line
 * outside a quoted scalar, which satisfies the scope bullet
 * "preserve comments when possible; explicit diagnostic when losing
 * them".
 */

import * as jsyamlNs from 'js-yaml';

// `@types/js-yaml@4.0.9` ships an `index.d.mts` that re-exports from
// `./index.js` — a path TypeScript's bundler resolution cannot find,
// so only `load` survives the type pass. The runtime ESM build
// (`dist/js-yaml.mjs`) does export the rest. Pin a typed surface for
// the names we actually call and trust the runtime shape.
interface JsYamlApi {
  load(str: string): unknown;
  dump(obj: unknown, opts?: { indent?: number; noRefs?: boolean; lineWidth?: number }): string;
  YAMLException: new (msg: string) => Error & { reason?: string };
}

const jsyaml = jsyamlNs as unknown as JsYamlApi;
const { load: loadYaml, dump: dumpYaml, YAMLException } = jsyaml;

export type YamlJsonIndent = 2 | 4;

export interface YamlJsonOptions {
  readonly indent: YamlJsonIndent;
}

export type YamlToJsonResult =
  | { ok: true; output: string; hadComments: boolean }
  | { ok: false; errorKey: string; message?: string };

export type JsonToYamlResult =
  | { ok: true; output: string }
  | { ok: false; errorKey: string; message?: string };

/** Indent values exposed for the panel's `<select>` rendering. */
export const YAML_JSON_INDENTS: readonly YamlJsonIndent[] = [2, 4];

export function convertYamlToJson(
  yaml: string,
  options: YamlJsonOptions
): YamlToJsonResult {
  const trimmed = yaml.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.yamlJson.error.empty' };
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(trimmed);
  } catch (error) {
    if (error instanceof YAMLException) {
      return {
        ok: false,
        errorKey: 'utilities.tool.yamlJson.error.invalidYaml',
        message: error.reason ?? error.message,
      };
    }
    return {
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.invalidYaml',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // `js-yaml.load` returns `undefined` for an empty document. Treat
  // that as the empty-input case so the panel surfaces a hint, not
  // a confusing JSON `null`.
  if (parsed === undefined) {
    return { ok: false, errorKey: 'utilities.tool.yamlJson.error.empty' };
  }

  let output: string;
  try {
    output = JSON.stringify(parsed, null, options.indent);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.invalidYaml',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, output, hadComments: detectYamlComments(trimmed) };
}

export function convertJsonToYaml(
  json: string,
  options: YamlJsonOptions
): JsonToYamlResult {
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.yamlJson.error.empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.invalidJson',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let output: string;
  try {
    output = dumpYaml(parsed, {
      indent: options.indent,
      // Prefer block style and skip aliases so the dump round-trips
      // cleanly through `load` again. `noRefs: true` drops anchors
      // for cyclic structures (which JSON.parse cannot produce
      // anyway, but defensive against future callers).
      noRefs: true,
      lineWidth: -1,
    });
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.yamlJson.error.invalidJson',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // js-yaml's `dump` always appends a trailing newline; strip it for
  // tidier output in the panel textarea.
  if (output.endsWith('\n')) {
    output = output.slice(0, -1);
  }

  return { ok: true, output };
}

/**
 * Detect `#`-started comments outside quoted scalars. Tracks
 * single- and double-quote state line-by-line so `key: "has # hash"`
 * does not register as a comment.
 */
function detectYamlComments(yaml: string): boolean {
  for (const line of yaml.split('\n')) {
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (!inSingle && char === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inDouble && char === "'") {
        // YAML's single-quoted scalar escape for a literal apostrophe is
        // `''` (two adjacent single-quotes). When we're inside such a
        // scalar and see a doubled `''`, consume both characters and
        // stay inside the scalar — otherwise we'd toggle out and
        // mistake any later `#` for a comment.
        if (inSingle && line[index + 1] === "'") {
          index += 1;
          continue;
        }
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inDouble && char === '#') {
        return true;
      }
    }
  }
  return false;
}
