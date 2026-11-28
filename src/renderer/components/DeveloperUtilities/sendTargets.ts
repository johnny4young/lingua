/**
 * Where an output goes next: the adapters its shape usually wants, each
 * previewed by running the same shared adapter on the output.
 */
import { classifyClipboard, type UtilitySuggestionId } from '../../clipboard/pasteHandlers';
import { detectsAsUrlEncoded } from '../../utils/developerUtilityDetection';
import { readAnswer } from '../Answer/answerObjectModel';
import { getAdapter } from '../../../shared/utilities/registry';
import type { UtilityAdapterId } from '../../../shared/utilities/types';
import { PREVIEW_MAX_CHARS, outputHead, shortDigest } from './launcherPreviews';

const SEND_CARD_COUNT = 3;

/** Same head the pipeline result row reads its answer from. */
const ANSWER_TEXT_MAX = 20_001;

type OutputShape = UtilitySuggestionId | 'url' | 'text';

/** A shape's own leads; every shape then falls back to the general text steps. */
const LEADS: Partial<Record<OutputShape, readonly UtilityAdapterId[]>> = {
  json: ['hash', 'base64-encode', 'json-minify', 'json-format'],
  jwt: ['jwt-decode'],
  base64: ['base64-decode'],
  url: ['url-decode', 'url-parse'],
  timestamp: ['timestamp'],
  color: ['color-convert'],
};

const FALLBACK: readonly UtilityAdapterId[] = ['hash', 'base64-encode', 'url-encode', 'string-case', 'slugify', 'text-stats', 'string-inspect'];

export interface SendTarget {
  readonly utilityId: UtilityAdapterId;
  /** The step's answer tag as its result row will read it; null when no preview was read. */
  readonly tag: string | null;
  readonly preview: string | null;
}

function outputShape(output: string): OutputShape {
  if (detectsAsUrlEncoded(output)) return 'url';
  return classifyClipboard(output) ?? 'text';
}

function candidates(output: string, exclude: UtilityAdapterId | undefined): UtilityAdapterId[] {
  const ordered = [...(LEADS[outputShape(output)] ?? []), ...FALLBACK];
  return [...new Set(ordered)].filter((id) => id !== exclude);
}

/** The answer the step would give: its tag, and a short head the way the launcher shortens a hash. */
export function describeOutput(utilityId: UtilityAdapterId, value: string): Pick<SendTarget, 'tag' | 'preview'> {
  const json = getAdapter(utilityId)?.outputKind === 'json';
  const { tag } = readAnswer(
    { text: value.slice(0, ANSWER_TEXT_MAX), length: value.length, ...(json ? {} : { role: 'text' as const }) },
    { now: Date.now(), locale: 'en' }
  );
  if (utilityId === 'hash') return { tag, preview: shortDigest(value) };
  const head = outputHead(value, 8);
  return { tag, preview: json ? head : `"${head}"` };
}

async function preview(utilityId: UtilityAdapterId, output: string): Promise<SendTarget | null> {
  const adapter = getAdapter(utilityId);
  if (!adapter) return null;
  const outcome = await adapter.run(output, adapter.defaultOptions()).catch(() => null);
  if (!outcome?.ok || outcome.value.length === 0 || outcome.value === output) return null;
  return { utilityId, ...describeOutput(utilityId, outcome.value) };
}

/**
 * Up to three adapters for this output, each with what it answers. An adapter
 * that fails on the output or hands it back unchanged gives way to the next.
 * An empty or oversized output keeps the ranking and reads no previews; an
 * aborted read stops between batches.
 */
export async function readSendTargets(output: string, exclude?: UtilityAdapterId, signal?: AbortSignal): Promise<SendTarget[]> {
  const ranked = candidates(output, exclude);
  if (output.length === 0 || output.length > PREVIEW_MAX_CHARS) {
    return ranked.slice(0, SEND_CARD_COUNT).map((utilityId) => ({ utilityId, tag: null, preview: null }));
  }
  const targets: SendTarget[] = [];
  for (let at = 0; at < ranked.length && targets.length < SEND_CARD_COUNT && !signal?.aborted; ) {
    const batch = ranked.slice(at, at + SEND_CARD_COUNT - targets.length);
    at += batch.length;
    const read = await Promise.all(batch.map((utilityId) => preview(utilityId, output)));
    targets.push(...read.filter((target): target is SendTarget => target !== null));
  }
  return targets;
}
