/**
 * implementation — Recipe / `LessonPackV1` schema.
 *
 * `LessonPackV1` is the JSON-serialisable record of one curated
 * Lingua practice problem: a problem statement, a starter code
 * scaffold, and a handful of assertions that decide whether the
 * user's edits solved the problem. The schema deliberately stays
 * language-generic — implementation shipped 10 JavaScript recipes and implementation
 * adds TypeScript / Python packs — and capsule-friendly so a future
 * "reference solution" implementation can embed a known-good
 * `RunCapsuleV1.contentHash` next to each assertion.
 *
 * Downstream consumers (today or planned):
 *
 *   - The Recipes overlay (`Mod+Alt+L`) renders the catalog list.
 *   - `<RecipeRunPanel>` mounts when a tab is bound to a recipe and
 *     wires the Run + Test button to `buildLessonRunSource`.
 *   - implementation (planned) ships `lingua lesson validate
 *     path/to/recipe.json` — depends on this schema staying
 *     `version: 1` literal.
 *   - implementation (planned) attaches an AI-generated hint to a
 *     recipe via a fresh `aiHint` field (additive; won't break the
 *     `version: 1` invariant).
 *
 * Closed enums:
 *
 *   - `LESSON_REJECT_REASONS` — every reason `parseLessonPack` can
 *     return on `{ok: false}`. The Recipes overlay maps each code
 *     to a localized hint via `recipes.reject.<reason>` keys.
 *   - `ASSERTION_EXIT_KINDS` — what kind of assertion contract the
 *     `code` field uses. implementation ships all three (`value` returns
 *     a truthy result, `throw` expects the snippet to throw,
 *     `console-contains` looks for a substring on stdout). The
 *     runner switches on this to interpret the assertion's result.
 *
 * Privacy posture:
 *
 *   - Bundled recipes are public domain catalog content; the schema
 *     can also represent user-authored recipes (future work import via
 *     the internal registry). The `parseLessonPack` guard caps payload
 *     size + asserts the closed-enum surface so a hand-crafted JSON
 *     cannot bring down the overlay.
 *   - Per-recipe telemetry stays language-bucketed implementation. No
 *     recipe id reaches the wire (implementation note in the plan).
 */

import { LANGUAGE_PACKS, type LanguagePackId } from './languagePacks';

// ---------------------------------------------------------------------------
// Closed enums
// ---------------------------------------------------------------------------

/**
 * Closed-enum reject reasons returned by `parseLessonPack`. Adding a
 * reason is additive; renaming/removing breaks the localized hint
 * map in `src/renderer/components/Recipes/RecipesOverlay.tsx`.
 */
export const LESSON_REJECT_REASONS = [
  'malformed-json',
  'wrong-version',
  'invalid-shape',
  'unknown-language',
  'oversized',
] as const;
export type LessonRejectReason = (typeof LESSON_REJECT_REASONS)[number];

/**
 * Closed-enum assertion exit-kind discriminants. The implementation runner
 * (`src/shared/lessonRunner.ts`) switches on this to decide how to
 * interpret the snippet's effect.
 *
 *   - `'value'` — the assertion `code` is a JavaScript expression
 *     that must evaluate to a truthy value. The composed source
 *     wraps it in `Boolean(...)` so `undefined` / `null` / `0` /
 *     `""` are all `'fail'`.
 *   - `'throw'` — the assertion `code` is expected to throw. A
 *     thrown error is `'pass'`; a non-throw is `'fail'`.
 *   - `'console-contains'` — the assertion `code` is a literal
 *     substring; if the user's program stdout contains it the
 *     assertion is `'pass'`. The renderer-side stdout buffer is
 *     consulted; the snippet itself does NOT run.
 */
export const ASSERTION_EXIT_KINDS = [
  'value',
  'throw',
  'console-contains',
] as const;
export type AssertionExitKind = (typeof ASSERTION_EXIT_KINDS)[number];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Localized prose body — `en` is required (fallback), `es` optional. */
export interface LessonProse {
  readonly en: string;
  readonly es?: string;
}

export interface AssertionV1 {
  /** Stable id used by the result row. Slug; no whitespace. */
  readonly id: string;
  /** Localized name shown next to the pass / fail badge. */
  readonly name: LessonProse;
  /** The assertion contract per `kind`. */
  readonly code: string;
  /** How the runner interprets `code`. */
  readonly kind: AssertionExitKind;
  /**
   * Optional hint shown when the assertion fails — short, actionable
   * (implementation note in the plan). Capped at ~200 chars in the renderer.
   */
  readonly hint?: LessonProse;
}

export interface LessonPackV1 {
  /** Hard-pinned `1` literal so a future schema flip is forced through `parseLessonPack`. */
  readonly version: 1;
  /** Stable slug id — bundled recipes use `js-`, `ts-`, or `py-` namespaces. */
  readonly id: string;
  /** Language-pack id. The runnable catalog currently covers JS, TS, and Python. */
  readonly language: LanguagePackId;
  /** Localized title (`en` mandatory, `es` optional). */
  readonly title: LessonProse;
  /** Localized prompt body — markdown subset (see `recipeMarkdown.tsx`). */
  readonly prompt: LessonProse;
  /** Starter code shown in the new tab when the recipe is opened. */
  readonly starterCode: string;
  /** Closed-list assertions; `MAX_ASSERTIONS_PER_PACK` enforced by parser. */
  readonly assertions: ReadonlyArray<AssertionV1>;
  /** Short, lowercase, alphanumeric tags surfaced in the overlay row. */
  readonly tags: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Recipes are bite-sized by design. implementation's largest bundled recipe
 * is ~3 KiB; the 32 KiB ceiling exists so a future user-authored
 * recipe (future work import) cannot smuggle a multi-MB blob into the
 * overlay.
 */
export const MAX_LESSON_PACK_BYTES = 32 * 1024;
export const MAX_ASSERTIONS_PER_PACK = 10;
/** Max characters per assertion `code` snippet — guards against pathological inputs. */
export const MAX_ASSERTION_CODE_LENGTH = 2_000;
/** Max characters per `starterCode` block. */
export const MAX_STARTER_CODE_LENGTH = 8_000;
/** Max chars of prompt body across both locales combined. */
export const MAX_PROMPT_LENGTH = 6_000;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type LessonParseOutcome =
  | { readonly ok: true; readonly pack: LessonPackV1 }
  | { readonly ok: false; readonly reason: LessonRejectReason };

/**
 * Parse a raw JSON string or an in-memory object into a typed
 * `LessonPackV1`. Always settles to a discriminated outcome — never
 * throws. Used by:
 *
 *   - `tests/data/recipes.test.ts` to assert every bundled recipe
 *     parses cleanly at build time (catches author drift).
 *   - The future CLI `lingua lesson validate` .
 *   - future work import flow when user-authored recipes land.
 */
export function parseLessonPack(input: unknown): LessonParseOutcome {
  // 1. Decode + size cap.
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_LESSON_PACK_BYTES) {
      return { ok: false, reason: 'oversized' };
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, reason: 'malformed-json' };
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const obj = raw as Record<string, unknown>;

  // 2. Version pin.
  if (obj.version !== 1) {
    return { ok: false, reason: 'wrong-version' };
  }

  // 3. Required scalar fields.
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (typeof obj.language !== 'string' || obj.language.length === 0) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (!isKnownLanguage(obj.language)) {
    return { ok: false, reason: 'unknown-language' };
  }
  if (typeof obj.starterCode !== 'string') {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.starterCode.length > MAX_STARTER_CODE_LENGTH) {
    return { ok: false, reason: 'oversized' };
  }

  // 4. Localized prose blobs.
  const title = parseProse(obj.title);
  if (title === null) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const prompt = parseProse(obj.prompt);
  if (prompt === null) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const promptLength = prompt.en.length + (prompt.es?.length ?? 0);
  if (promptLength > MAX_PROMPT_LENGTH) {
    return { ok: false, reason: 'oversized' };
  }

  // 5. Tags.
  if (!Array.isArray(obj.tags)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const tags: string[] = [];
  for (const tag of obj.tags) {
    if (typeof tag !== 'string') {
      return { ok: false, reason: 'invalid-shape' };
    }
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 24) {
      return { ok: false, reason: 'invalid-shape' };
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
      return { ok: false, reason: 'invalid-shape' };
    }
    tags.push(normalized);
  }

  // 6. Assertions.
  if (!Array.isArray(obj.assertions)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.assertions.length === 0) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (obj.assertions.length > MAX_ASSERTIONS_PER_PACK) {
    return { ok: false, reason: 'oversized' };
  }
  const assertions: AssertionV1[] = [];
  const seenAssertionIds = new Set<string>();
  for (const rawAssertion of obj.assertions) {
    const parsed = parseAssertion(rawAssertion);
    if (parsed === null) {
      return { ok: false, reason: 'invalid-shape' };
    }
    if (seenAssertionIds.has(parsed.id)) {
      return { ok: false, reason: 'invalid-shape' };
    }
    seenAssertionIds.add(parsed.id);
    assertions.push(parsed);
  }

  const pack: LessonPackV1 = {
    version: 1,
    id: obj.id,
    language: obj.language as LanguagePackId,
    title,
    prompt,
    starterCode: obj.starterCode,
    assertions,
    tags,
  };
  return { ok: true, pack };
}

function parseProse(raw: unknown): LessonProse | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.en !== 'string' || obj.en.length === 0) return null;
  if (obj.es !== undefined && typeof obj.es !== 'string') return null;
  return obj.es !== undefined ? { en: obj.en, es: obj.es } : { en: obj.en };
}

function parseAssertion(raw: unknown): AssertionV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(obj.id)) {
    return null;
  }
  if (typeof obj.code !== 'string') return null;
  if (obj.code.length === 0 || obj.code.length > MAX_ASSERTION_CODE_LENGTH) {
    return null;
  }
  if (typeof obj.kind !== 'string') return null;
  if (!(ASSERTION_EXIT_KINDS as readonly string[]).includes(obj.kind)) {
    return null;
  }
  const name = parseProse(obj.name);
  if (name === null) return null;
  let hint: LessonProse | undefined;
  if (obj.hint !== undefined) {
    const parsedHint = parseProse(obj.hint);
    if (parsedHint === null) return null;
    hint = parsedHint;
  }
  return {
    id: obj.id,
    name,
    code: obj.code,
    kind: obj.kind as AssertionExitKind,
    ...(hint !== undefined ? { hint } : {}),
  };
}

function isKnownLanguage(value: string): value is LanguagePackId {
  return LANGUAGE_PACKS.some((pack) => pack.id === value);
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Pick the locale-appropriate prose, falling back to `en` when the
 * `es` field is missing. The renderer ALWAYS calls through this
 * helper so a future locale  only has to add a new arm.
 */
export function pickProse(prose: LessonProse, locale: 'en' | 'es'): string {
  if (locale === 'es' && prose.es !== undefined) return prose.es;
  return prose.en;
}

/**
 * Return a one-line preview of the prompt body for the overlay list.
 * Strips leading markdown markers and collapses whitespace; caller
 * decides truncation length.
 */
export function previewPromptLine(
  prompt: LessonProse,
  locale: 'en' | 'es',
  maxChars = 80
): string {
  const raw = pickProse(prompt, locale);
  const firstParagraph = raw.split(/\n\s*\n/)[0] ?? raw;
  const stripped = firstParagraph
    .replace(/^#+\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxChars) return stripped;
  return `${stripped.slice(0, maxChars - 1).trimEnd()}…`;
}
