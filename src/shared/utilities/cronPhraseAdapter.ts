/**
 * `cron-phrase` adapter — natural-language schedule → cron expression.
 *
 * Wraps the shared engine (`./cronPhrase`) so the SAME grammar the Cron
 * Parser panel uses is reachable from `lingua utility cron-phrase` and from
 * utility pipelines: `echo 'cada 3 dias 8am' | lingua utility cron-phrase`.
 *
 * Output is the bare expression by default so it stays pipe-clean; the
 * `annotate` option appends the engine's assumptions and caveats as
 * `#`-prefixed comment lines, which crontab itself would accept. The engine
 * reports notes as renderer i18n keys — the UI translates them, while this
 * adapter (an English-only surface, like all CLI output) renders them
 * through the table below. A key missing from the table falls back to its
 * bare id rather than crashing, and the registry test asserts the table
 * stays complete so that fallback never actually ships.
 */

import type { UtilityAdapter, UtilityOptionField } from './types';
import { phraseToCron } from './cronPhrase';
import type { CronPhraseNote } from './cronPhrase';

/** Structured options for the `cron-phrase` adapter. */
export interface CronPhraseAdapterOptions {
  readonly annotate: boolean;
}

/**
 * English rendering of every note key the engine can emit. `{{name}}`
 * placeholders match the values the engine attaches to the note.
 */
export const CRON_PHRASE_NOTE_TEXT: Readonly<Record<string, string>> = {
  'utilities.tool.cron.phrase.assumption.minuteZero': 'Assumed minute 0.',
  'utilities.tool.cron.phrase.assumption.midnight': 'No time given; assumed 00:00.',
  'utilities.tool.cron.phrase.assumption.monday': 'No weekday given; assumed Monday.',
  'utilities.tool.cron.phrase.assumption.firstOfMonth': 'Assumed day 1 of the month.',
  'utilities.tool.cron.phrase.assumption.daily': 'Runs every day at that time.',
  'utilities.tool.cron.phrase.assumption.hourlyWindow': 'Hourly within the window.',
  'utilities.tool.cron.phrase.assumption.pmWindowEnd':
    'Read the window end as {{shifted}}:00 ({{end}} pm).',
  'utilities.tool.cron.phrase.assumption.january': 'A yearly schedule needs a date; assumed January 1.',
  'utilities.tool.cron.phrase.caveat.noYearField':
    'Cron has no year field, so an every-{{step}}-years cadence cannot be expressed. This fires every January 1 instead.',
  'utilities.tool.cron.phrase.caveat.nonstandardNthWeekday':
    'The # operator (nth weekday of the month) is a Quartz extension, not POSIX cron.',
  'utilities.tool.cron.phrase.caveat.nonstandardLastWeekday':
    'The L operator on a weekday (last one of the month) is a Quartz extension, not POSIX cron.',
  'utilities.tool.cron.phrase.caveat.domStepReset':
    'The {{step}}-day step restarts at the start of every month, so the gap breaks at month boundaries.',
  'utilities.tool.cron.phrase.caveat.domDowUnion':
    'Cron treats day-of-month plus weekday as either/or: this fires on those dates AND on those weekdays.',
  'utilities.tool.cron.phrase.caveat.nonstandardLast':
    'L (last day) is not POSIX-standard cron; check your scheduler accepts it.',
  'utilities.tool.cron.phrase.caveat.minuteStepUneven':
    '60 is not divisible by {{step}}; the count restarts each hour, leaving a {{tail}}-minute gap.',
  'utilities.tool.cron.phrase.caveat.hourStepUneven':
    '24 is not divisible by {{step}}; the count restarts at midnight, leaving a {{tail}}-hour gap.',
  'utilities.tool.cron.phrase.caveat.monthStepUneven':
    '12 is not divisible by {{step}}; the count restarts each January, leaving a {{tail}}-month gap.',
  'utilities.tool.cron.phrase.unsupported.multiWeek':
    'Cron cannot express a continuous every-{{step}}-weeks schedule. Closest options: fixed days like 1,15, or run weekly and skip inside the job.',
  'utilities.tool.cron.phrase.unsupported.mixedTimes':
    'One cron expression cannot combine times with different minutes (the fields multiply). Create one expression per time.',
  'utilities.tool.cron.phrase.unsupported.stepOutOfRange':
    'A step of {{step}} does not fit this cron field (maximum {{max}}). Express it with the next larger unit.',
  'utilities.tool.cron.phrase.unsupported.conflictingIntervals':
    'The phrase asks for two competing cadences at once. Keep one interval per expression.',
};

/** Render a note to plain English, interpolating its values. */
export function renderCronPhraseNote(note: CronPhraseNote): string {
  const template = CRON_PHRASE_NOTE_TEXT[note.key] ?? note.key;
  return template.replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
    String(note.values?.[name] ?? `{{${name}}}`)
  );
}

const ANNOTATE_OPTION: UtilityOptionField = {
  key: 'annotate',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.cronPhrase.options.annotate.label',
  defaultValue: false,
};

export const cronPhraseAdapter: UtilityAdapter<CronPhraseAdapterOptions> = {
  id: 'cron-phrase',
  titleKey: 'utilityPipeline.adapter.cronPhrase.title',
  descriptionKey: 'utilityPipeline.adapter.cronPhrase.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [ANNOTATE_OPTION],
  defaultOptions: () => ({ annotate: false }),
  parseOptions: raw => {
    if (raw === undefined || raw === null) return { annotate: false };
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as { annotate?: unknown };
    const annotate = candidate.annotate === undefined ? false : candidate.annotate;
    if (typeof annotate !== 'boolean') return null;
    return { annotate };
  },
  run: async (input, options) => {
    const result = phraseToCron(input);
    if (!result.ok) {
      if (result.reason === 'empty') {
        return { ok: false, reason: 'invalid-input', detail: 'Empty phrase.' };
      }
      if (result.reason === 'unrecognized') {
        const leftover =
          result.leftover && result.leftover.length > 0
            ? ` Not understood: ${result.leftover.join(', ')}.`
            : '';
        return {
          ok: false,
          reason: 'invalid-input',
          detail: `Could not turn the phrase into a schedule.${leftover}`,
        };
      }
      return {
        ok: false,
        reason: 'unsupported',
        detail: result.detail ? renderCronPhraseNote(result.detail) : 'Unsupported schedule.',
      };
    }
    if (!options.annotate) return { ok: true, value: result.expression };
    const lines = [
      result.expression,
      ...result.assumptions.map(note => `# assumption: ${renderCronPhraseNote(note)}`),
      ...result.caveats.map(note => `# caveat: ${renderCronPhraseNote(note)}`),
    ];
    return { ok: true, value: lines.join('\n') };
  },
};
