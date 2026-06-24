/**
 * RL-099 Slice 5 — pipeline template gallery catalog.
 *
 * A curated, static set of starter pipelines so the (otherwise blank)
 * pipeline panel is discoverable now that the engine ships 15 adapters.
 * Templates are RECIPE-ONLY — steps + options, never input data — except
 * for an optional `sampleInput` the gallery drops into the input box so a
 * freshly-instantiated template is immediately runnable (fold F).
 *
 * Pure shared data: the renderer reads this, supplies fresh ids, and
 * instantiates via {@link instantiatePipelineTemplate}. The catalog
 * cannot import the renderer (boundary); ids are caller-supplied,
 * mirroring `createBlankStep`.
 */

import { getAdapter } from './utilities/registry';
import type { UtilityAdapterId } from './utilities/types';
import {
  createBlankPipeline,
  createBlankStep,
  type PipelineStepV1,
  type UtilityPipelineV1,
} from './utilityPipeline';

/**
 * Closed enum of template ids. Curated catalog — safe to surface on
 * telemetry (fold A) because the value space is a fixed, content-free
 * list. Add a template here AND in {@link PIPELINE_TEMPLATES} AND with
 * `utilityPipeline.template.<camelId>.{name,description}` in both
 * locales.
 */
export const PIPELINE_TEMPLATE_IDS = [
  'decode-jwt',
  'hash-base64',
  'url-decode-json',
  'html-decode',
  'slugify',
  'base64-decode-json',
  'humanize-timestamp',
  'convert-color',
  // RL-099 Slice 7 (fold D) — surface the new `string-inspect` adapter
  // from the empty-state gallery.
  'inspect-hidden-chars',
] as const;
export type PipelineTemplateId = (typeof PIPELINE_TEMPLATE_IDS)[number];

/**
 * One curated starter pipeline. `steps` reference adapter ids from the
 * registry; per-step `options` (when present) are validated through the
 * adapter's `parseOptions` at instantiate time and dropped to defaults
 * on mismatch. `sampleInput` seeds the input box (fold F) — never auto-
 * run.
 */
export interface PipelineTemplate {
  readonly id: PipelineTemplateId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly steps: ReadonlyArray<{
    readonly utilityId: UtilityAdapterId;
    readonly options?: Record<string, unknown>;
  }>;
  readonly sampleInput: string;
}

/**
 * The curated catalog. Each template composes shipped adapters into a
 * common developer flow. Most omitted options fall back to the adapter
 * default; templates may spell out defaults when the named recipe would
 * otherwise drift if an adapter default changed.
 */
export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: 'decode-jwt',
    nameKey: 'utilityPipeline.template.decodeJwt.name',
    descriptionKey: 'utilityPipeline.template.decodeJwt.description',
    steps: [{ utilityId: 'jwt-decode' }],
    sampleInput:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiJBZGEifQ.sig',
  },
  {
    id: 'hash-base64',
    nameKey: 'utilityPipeline.template.hashBase64.name',
    descriptionKey: 'utilityPipeline.template.hashBase64.description',
    steps: [
      { utilityId: 'hash', options: { algorithm: 'SHA-256' } },
      { utilityId: 'base64-encode' },
    ],
    sampleInput: 'hello',
  },
  {
    id: 'url-decode-json',
    nameKey: 'utilityPipeline.template.urlDecodeJson.name',
    descriptionKey: 'utilityPipeline.template.urlDecodeJson.description',
    steps: [{ utilityId: 'url-decode' }, { utilityId: 'json-format' }],
    sampleInput: '%7B%22a%22%3A1%2C%22b%22%3A%5B2%2C3%5D%7D',
  },
  {
    id: 'html-decode',
    nameKey: 'utilityPipeline.template.htmlDecode.name',
    descriptionKey: 'utilityPipeline.template.htmlDecode.description',
    steps: [{ utilityId: 'html-entity-decode' }],
    sampleInput: '&lt;b&gt;caf&#233; &amp; co&lt;/b&gt;',
  },
  {
    id: 'slugify',
    nameKey: 'utilityPipeline.template.slugify.name',
    descriptionKey: 'utilityPipeline.template.slugify.description',
    // RL-099 Slice 6 — use the dedicated slugify adapter now that it
    // exists; the previous string-case/kebab stand-in did not strip
    // punctuation or fold diacritics, so it was not URL-slug safe.
    steps: [
      {
        utilityId: 'slugify',
        options: { separator: 'hyphen', lowercase: true },
      },
    ],
    sampleInput: 'Hello World Example',
  },
  {
    id: 'base64-decode-json',
    nameKey: 'utilityPipeline.template.base64DecodeJson.name',
    descriptionKey: 'utilityPipeline.template.base64DecodeJson.description',
    steps: [{ utilityId: 'base64-decode' }, { utilityId: 'json-format' }],
    sampleInput: 'eyJhIjoxLCJiIjpbMiwzXX0=',
  },
  {
    id: 'humanize-timestamp',
    nameKey: 'utilityPipeline.template.humanizeTimestamp.name',
    descriptionKey: 'utilityPipeline.template.humanizeTimestamp.description',
    steps: [{ utilityId: 'timestamp' }],
    sampleInput: '1700000000',
  },
  {
    id: 'convert-color',
    nameKey: 'utilityPipeline.template.convertColor.name',
    descriptionKey: 'utilityPipeline.template.convertColor.description',
    steps: [{ utilityId: 'color-convert' }],
    sampleInput: '#3366ff',
  },
  {
    id: 'inspect-hidden-chars',
    nameKey: 'utilityPipeline.template.inspectHiddenChars.name',
    descriptionKey: 'utilityPipeline.template.inspectHiddenChars.description',
    // The sample input hides a zero-width space (U+200B) between the two
    // words, so the report's Warnings line reads `zero-width 1` out of the
    // box — the adapter's headline signal.
    steps: [{ utilityId: 'string-inspect' }],
    sampleInput: 'hello\u200Bworld',
  },
];

/** Look up a template by id; `undefined` for an unknown id. */
export function getPipelineTemplate(
  id: string
): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((template) => template.id === id);
}

/**
 * Build a fresh `UtilityPipelineV1` from a template. Ids are
 * caller-supplied (the shared layer stays free of `crypto`): pass a
 * `stepIds` array at least as long as the template's step list. Each
 * step's options are validated through the adapter's `parseOptions`;
 * an invalid blob silently falls back to the adapter default so a
 * catalog typo can never produce an unrunnable step.
 */
export function instantiatePipelineTemplate(
  template: PipelineTemplate,
  options: {
    pipelineId: string;
    stepIds: readonly string[];
    name: string;
    now?: string;
  }
): UtilityPipelineV1 {
  const pipeline = createBlankPipeline({
    id: options.pipelineId,
    name: options.name,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const steps: PipelineStepV1[] = template.steps.map((templateStep, index) => {
    // Deterministic fallback id (no crypto in shared) if the caller
    // under-supplies ids — keeps every step uniquely keyed.
    const stepId =
      options.stepIds[index] ?? `${options.pipelineId}-step-${index}`;
    const base = createBlankStep({
      id: stepId,
      utilityId: templateStep.utilityId,
    });
    if (templateStep.options) {
      const adapter = getAdapter(templateStep.utilityId);
      const parsed = adapter?.parseOptions(templateStep.options) ?? null;
      if (parsed) {
        return { ...base, options: parsed as Record<string, unknown> };
      }
    }
    return base;
  });
  return { ...pipeline, steps };
}
