/**
 * Natural-language phrase → cron expression. Deterministic, bilingual, offline.
 *
 * The counterpart of `cronParser.ts`: that file explains an expression, this
 * one writes it from intent expressed in words — "cada 3 días a las 8am",
 * "weekdays at 9", "every 15 minutes between 9 and 5".
 *
 * Design constraints, in priority order:
 *
 * 1. FAITHFUL over lenient. Every token in the phrase must either be consumed
 *    by an extractor or be a known filler word; anything else fails as
 *    unrecognized rather than silently ignored. A generator that drops words
 *    it does not understand produces schedules the user did not ask for.
 * 2. Transparent defaults. Whenever the engine fills a gap (no time given →
 *    midnight; weekly with no weekday → Monday) it reports an assumption the
 *    panel renders as a chip, so the inferred parts are visible.
 * 3. Honest impossibilities. Some intents cron cannot express — a continuous
 *    "every 2 weeks", or "8:15 and 20:30" in one expression (the fields are a
 *    cross product, so that would also fire at 8:30 and 20:15). Those return
 *    a typed failure with an explanation key instead of a wrong approximation.
 * 4. Warn on the classics. A day-of-month step resets at every month boundary
 *    (the classic step-in-day-of-month gotcha); day-of-month plus weekday
 *    is an OR in cron, not an AND. Both are detected and surfaced as caveats.
 *
 * Both locales are always active — a Spanish speaker typing "cada 3 days" is
 * common enough that gating keyword tables on the UI locale would only
 * manufacture failures.
 *
 * Output expressions are built from bounded numeric sets, so they are valid by
 * construction; the panel still routes them through the real parser
 * (`cronParser.ts`), which is the single source of truth for validation,
 * explanation, and the next-runs preview. Tests additionally round-trip every
 * accepted expression through that parser.
 */

export interface CronPhraseNote {
  /** i18n key under utilities.tool.cron.phrase.* */
  readonly key: string;
  /** Interpolation values for the key, when it takes any. */
  readonly values?: Readonly<Record<string, string | number>>;
}

export type CronPhraseResult =
  | {
      readonly ok: true;
      /** Five-field cron expression reflecting the phrase. */
      readonly expression: string;
      /** Defaults the engine filled in; render as informational chips. */
      readonly assumptions: readonly CronPhraseNote[];
      /** Correctness warnings about the produced schedule; render prominently. */
      readonly caveats: readonly CronPhraseNote[];
    }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'unrecognized' | 'unsupported';
      /** For `unsupported`: which impossibility, as an i18n key. */
      readonly detail?: CronPhraseNote;
      /** For `unrecognized`: the tokens the engine could not consume. */
      readonly leftover?: readonly string[];
    };

interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

interface Extraction {
  /** [start, end) spans of the normalized string consumed by extractors. */
  spans: Array<[number, number]>;
  times: TimeOfDay[];
  hourRange: { start: number; end: number; pmAssumed: boolean } | null;
  interval: { unit: 'minute' | 'hour' | 'day' | 'week' | 'month'; step: number } | null;
  weekdays: Set<number>;
  weekdayRange: { from: number; to: number } | null;
  monthDays: number[];
  lastDayOfMonth: boolean;
  months: number[];
}

const WEEKDAYS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:sundays?|domingos?|dom|sun)\b/g, 0],
  [/\b(?:mondays?|lunes|mon|lun)\b/g, 1],
  [/\b(?:tuesdays?|martes|tue|tues|mar)\b/g, 2],
  [/\b(?:wednesdays?|miercoles|wed|mie)\b/g, 3],
  [/\b(?:thursdays?|jueves|thu|thur|thurs|jue)\b/g, 4],
  [/\b(?:fridays?|viernes|fri|vie)\b/g, 5],
  [/\b(?:saturdays?|sabados?|sat|sab)\b/g, 6],
];

const MONTHS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:january|enero|jan|ene)\b/g, 1],
  [/\b(?:february|febrero|feb)\b/g, 2],
  [/\b(?:march|marzo)\b/g, 3],
  [/\b(?:april|abril|apr|abr)\b/g, 4],
  [/\b(?:may|mayo)\b/g, 5],
  [/\b(?:june|junio|jun)\b/g, 6],
  [/\b(?:july|julio|jul)\b/g, 7],
  [/\b(?:august|agosto|aug|ago)\b/g, 8],
  [/\b(?:september|septiembre|setiembre|sep|sept)\b/g, 9],
  [/\b(?:october|octubre|oct)\b/g, 10],
  [/\b(?:november|noviembre|nov)\b/g, 11],
  [/\b(?:december|diciembre|dec|dic)\b/g, 12],
];

/**
 * Words that may legitimately remain unconsumed. Anything else left over
 * fails the phrase — see design constraint 1.
 */
const FILLER = new Set([
  'cron',
  'job',
  'task',
  'tarea',
  'schedule',
  'horario',
  'expresion',
  'expression',
  'run',
  'runs',
  'running',
  'ejecuta',
  'ejecutar',
  'ejecutame',
  'corre',
  'correr',
  'lanza',
  'lanzar',
  'programa',
  'programar',
  'a',
  'al',
  'las',
  'la',
  'el',
  'los',
  'lo',
  'de',
  'del',
  'en',
  'y',
  'e',
  'o',
  'u',
  'un',
  'una',
  'que',
  'por',
  'para',
  'punto',
  'horas',
  'hora',
  'hrs',
  'hs',
  'at',
  'of',
  'on',
  'in',
  'the',
  'and',
  'or',
  'a.m',
  'p.m',
  'am',
  'pm',
  'oclock',
  'every',
  'cada',
  'todos',
  'todas',
  'dias',
  'dia',
  'me',
  'mi',
  'my',
  'please',
]);

/** Lowercase, strip diacritics, collapse whitespace and stray punctuation. */
function normalize(phrase: string): string {
  return phrase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[.,;!?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function consume(state: Extraction, start: number, end: number): void {
  state.spans.push([start, end]);
}

function runAll(regex: RegExp, text: string, onMatch: (m: RegExpExecArray) => void): void {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    onMatch(match);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
}

function toHour(raw: string, meridiem: string | undefined): number | null {
  let hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return hour;
}

/**
 * Extract "between 9 and 5" / "de 9 a 17" / "entre las 9 y las 5" hour
 * windows. When the end reads lower than the start and carries no explicit
 * meridiem, human intent is almost always "…to 5pm"; the shift is applied and
 * reported as an assumption.
 */
function extractHourRange(text: string, state: Extraction): void {
  const range =
    /\b(?:between|entre|de|desde|from)\s+(?:las?\s+)?(\d{1,2})\s*(am|pm)?\s+(?:and|y|a|hasta|to)\s+(?:las?\s+)?(\d{1,2})\s*(am|pm)?\b/g;
  runAll(range, text, m => {
    const start = toHour(m[1]!, m[2]);
    let end = toHour(m[3]!, m[4]);
    if (start === null || end === null) return;
    let pmAssumed = false;
    if (end < start && !m[4] && end <= 12) {
      end += 12;
      pmAssumed = true;
    }
    if (end <= start) return;
    state.hourRange = { start, end, pmAssumed };
    consume(state, m.index, m.index + m[0].length);
  });
}

/** Extract explicit clock times: "8am", "14:30", "a las 8", "noon", "medianoche". */
function extractTimes(text: string, state: Extraction): void {
  runAll(/\b(?:noon|mediodia)\b/g, text, m => {
    state.times.push({ hour: 12, minute: 0 });
    consume(state, m.index, m.index + m[0].length);
  });
  runAll(/\b(?:midnight|medianoche)\b/g, text, m => {
    state.times.push({ hour: 0, minute: 0 });
    consume(state, m.index, m.index + m[0].length);
  });

  // With minutes, meridiem optional: 14:30, 8:15pm.
  runAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/g, text, m => {
    const hour = toHour(m[1]!, m[3]);
    const minute = Number(m[2]);
    if (hour === null || minute < 0 || minute > 59) return;
    state.times.push({ hour, minute });
    consume(state, m.index, m.index + m[0].length);
  });

  // Bare hour WITH meridiem: "8am", "8 pm".
  runAll(/\b(\d{1,2})\s*(am|pm)\b/g, text, m => {
    if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
    const hour = toHour(m[1]!, m[2]);
    if (hour === null) return;
    state.times.push({ hour, minute: 0 });
    consume(state, m.index, m.index + m[0].length);
  });

  // Bare hour introduced by "at / a las": "at 8", "a las 17".
  runAll(/\b(?:at|a las?)\s+(\d{1,2})\b/g, text, m => {
    if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
    const tail = text.slice(m.index + m[0].length);
    if (/^\s*(?::|am|pm)/.test(tail)) return; // richer form already handled
    const hour = toHour(m[1]!, undefined);
    if (hour === null) return;
    state.times.push({ hour, minute: 0 });
    consume(state, m.index, m.index + m[0].length);
  });
}

/** Extract "every N unit" intervals and their single-word forms. */
function extractInterval(text: string, state: Extraction): void {
  const unitOf = (word: string): 'minute' | 'hour' | 'day' | 'week' | 'month' | null => {
    if (/^min(?:s|uto?s?|utes?)?$/.test(word)) return 'minute';
    if (/^(?:hours?|horas?|hrs?|hs)$/.test(word)) return 'hour';
    if (/^(?:days?|dias?)$/.test(word)) return 'day';
    if (/^(?:weeks?|semanas?)$/.test(word)) return 'week';
    if (/^(?:months?|mes(?:es)?)$/.test(word)) return 'month';
    return null;
  };

  runAll(/\b(?:every|cada)\s+(?:(\d+)\s+)?([a-z]+)\b/g, text, m => {
    const unit = unitOf(m[2]!);
    if (!unit) return;
    const step = m[1] ? Number(m[1]) : 1;
    if (!Number.isInteger(step) || step < 1 || step > 999) return;
    state.interval = { unit, step };
    consume(state, m.index, m.index + m[0].length);
  });

  if (!state.interval) {
    const singles: ReadonlyArray<readonly [RegExp, Extraction['interval']]> = [
      [/\b(?:hourly)\b/g, { unit: 'hour', step: 1 }],
      [/\b(?:daily|diario|diaria|diariamente|todos los dias)\b/g, { unit: 'day', step: 1 }],
      [/\b(?:weekly|semanal|semanalmente)\b/g, { unit: 'week', step: 1 }],
      [/\b(?:monthly|mensual|mensualmente)\b/g, { unit: 'month', step: 1 }],
    ];
    for (const [regex, interval] of singles) {
      runAll(regex, text, m => {
        state.interval = interval;
        consume(state, m.index, m.index + m[0].length);
      });
    }
  }
}

/** Extract weekday names, ranges ("lunes a viernes") and the weekday/weekend groups. */
function extractWeekdays(text: string, state: Extraction): void {
  runAll(/\b(?:weekdays|entre semana|dias? (?:habiles|laborables)|business days)\b/g, text, m => {
    state.weekdayRange = { from: 1, to: 5 };
    consume(state, m.index, m.index + m[0].length);
  });
  runAll(/\b(?:weekends?|fines? de semana)\b/g, text, m => {
    state.weekdays.add(6);
    state.weekdays.add(0);
    consume(state, m.index, m.index + m[0].length);
  });

  // Name-to-name ranges must win over single names: match them first.
  const dayWord =
    '(?:sundays?|domingos?|mondays?|lunes|tuesdays?|martes|wednesdays?|miercoles|thursdays?|jueves|fridays?|viernes|saturdays?|sabados?)';
  const rangeRe = new RegExp(`\\b(${dayWord})\\s+(?:to|a|hasta|-)\\s+(${dayWord})\\b`, 'g');
  const dayNumber = (word: string): number | null => {
    for (const [regex, value] of WEEKDAYS) {
      regex.lastIndex = 0;
      if (regex.test(word)) return value;
    }
    return null;
  };
  runAll(rangeRe, text, m => {
    const from = dayNumber(m[1]!);
    const to = dayNumber(m[2]!);
    if (from === null || to === null || from === to) return;
    state.weekdayRange = { from, to };
    consume(state, m.index, m.index + m[0].length);
  });

  for (const [regex, value] of WEEKDAYS) {
    runAll(new RegExp(regex.source, 'g'), text, m => {
      if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
      state.weekdays.add(value);
      consume(state, m.index, m.index + m[0].length);
    });
  }
}

/** Extract day-of-month anchors: "el 15", "on the 1st", "primer dia del mes", "ultimo dia". */
function extractMonthDays(text: string, state: Extraction): void {
  runAll(/\b(?:first day(?: of (?:the )?month)?|primer dia(?: del? mes)?)\b/g, text, m => {
    state.monthDays.push(1);
    consume(state, m.index, m.index + m[0].length);
  });
  runAll(/\b(?:last day(?: of (?:the )?month)?|ultimo dia(?: del? mes)?)\b/g, text, m => {
    state.lastDayOfMonth = true;
    consume(state, m.index, m.index + m[0].length);
  });

  runAll(
    /\b(?:on the|el dia|los dias|el|dia)\s+(\d{1,2})(?:st|nd|rd|th)?(\s+(?:de cada mes|del mes|of (?:the |every )?month))?\b/g,
    text,
    m => {
      if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
      // Without the "of the month" tail, a bare "el 15" is ambiguous with an
      // hour in Spanish ("el 15" vs "a las 15") — require the tail OR an
      // ordinal suffix to read it as a date.
      if (!m[2] && !/(?:st|nd|rd|th)/.test(m[0])) return;
      const day = Number(m[1]);
      if (!Number.isInteger(day) || day < 1 || day > 31) return;
      state.monthDays.push(day);
      consume(state, m.index, m.index + m[0].length);
    }
  );
}

/** Extract month names. */
function extractMonths(text: string, state: Extraction): void {
  for (const [regex, value] of MONTHS) {
    runAll(new RegExp(regex.source, 'g'), text, m => {
      if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
      if (!state.months.includes(value)) state.months.push(value);
      consume(state, m.index, m.index + m[0].length);
    });
  }
}

function leftoverTokens(text: string, spans: Array<[number, number]>): string[] {
  const masked = text
    .split('')
    .map((ch, i) => (spans.some(([s, e]) => i >= s && i < e) ? ' ' : ch))
    .join('');
  return masked
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 0 && !FILLER.has(token));
}

function formatDow(state: Extraction): string | null {
  if (state.weekdayRange) {
    const { from, to } = state.weekdayRange;
    return from < to ? `${from}-${to}` : `${from}-6,0-${to}`;
  }
  if (state.weekdays.size > 0) {
    return [...state.weekdays].sort((a, b) => a - b).join(',');
  }
  return null;
}

export function phraseToCron(phrase: string): CronPhraseResult {
  const text = normalize(phrase);
  if (text.length === 0) return { ok: false, reason: 'empty' };

  const state: Extraction = {
    spans: [],
    times: [],
    hourRange: null,
    interval: null,
    weekdays: new Set(),
    weekdayRange: null,
    monthDays: [],
    lastDayOfMonth: false,
    months: [],
  };

  // Order matters: ranges before bare times (so "de 9 a 17" is not read as
  // two clock times), intervals before times (so "cada 3" is not an hour),
  // weekday ranges before single day names.
  extractHourRange(text, state);
  extractInterval(text, state);
  extractWeekdays(text, state);
  extractMonthDays(text, state);
  extractMonths(text, state);
  extractTimes(text, state);

  const leftover = leftoverTokens(text, state.spans);
  if (leftover.length > 0) {
    return { ok: false, reason: 'unrecognized', leftover };
  }

  const anythingExtracted =
    state.times.length > 0 ||
    state.hourRange !== null ||
    state.interval !== null ||
    state.weekdays.size > 0 ||
    state.weekdayRange !== null ||
    state.monthDays.length > 0 ||
    state.lastDayOfMonth ||
    state.months.length > 0;
  if (!anythingExtracted) {
    return { ok: false, reason: 'unrecognized', leftover: [] };
  }

  const assumptions: CronPhraseNote[] = [];
  const caveats: CronPhraseNote[] = [];

  // ---- impossibilities first -------------------------------------------
  if (state.interval && state.interval.unit === 'week' && state.interval.step > 1) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: {
        key: 'utilities.tool.cron.phrase.unsupported.multiWeek',
        values: { step: state.interval.step },
      },
    };
  }
  const uniqueMinutes = new Set(state.times.map(t => t.minute));
  if (state.times.length > 1 && uniqueMinutes.size > 1) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: { key: 'utilities.tool.cron.phrase.unsupported.mixedTimes' },
    };
  }

  // ---- field composition ------------------------------------------------
  let minute = '*';
  let hour = '*';
  let dom = '*';
  let month = '*';
  let dow = '*';

  const dowValue = formatDow(state);
  if (dowValue) dow = dowValue;

  if (state.monthDays.length > 0) {
    dom = [...new Set(state.monthDays)].sort((a, b) => a - b).join(',');
  }
  if (state.lastDayOfMonth) {
    dom = dom === '*' ? 'L' : `${dom},L`;
    caveats.push({ key: 'utilities.tool.cron.phrase.caveat.nonstandardLast' });
  }
  if (state.months.length > 0) {
    month = [...state.months].sort((a, b) => a - b).join(',');
  }

  if (state.times.length > 0) {
    const minuteValue = state.times[0]!.minute;
    minute = String(minuteValue);
    hour = [...new Set(state.times.map(t => t.hour))].sort((a, b) => a - b).join(',');
  }

  const interval = state.interval;
  if (interval) {
    switch (interval.unit) {
      case 'minute': {
        minute = interval.step === 1 ? '*' : `*/${interval.step}`;
        if (state.times.length > 0) {
          // "every 5 minutes at 8am" reads as: within hour 8.
          hour = [...new Set(state.times.map(t => t.hour))].sort((a, b) => a - b).join(',');
        }
        if (state.hourRange) hour = `${state.hourRange.start}-${state.hourRange.end}`;
        break;
      }
      case 'hour': {
        hour = interval.step === 1 ? '*' : `*/${interval.step}`;
        if (state.times.length === 0) {
          minute = '0';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.minuteZero' });
        }
        if (state.hourRange) {
          hour =
            interval.step === 1
              ? `${state.hourRange.start}-${state.hourRange.end}`
              : `${state.hourRange.start}-${state.hourRange.end}/${interval.step}`;
        }
        break;
      }
      case 'day': {
        if (interval.step > 1) {
          dom = `*/${interval.step}`;
          caveats.push({
            key: 'utilities.tool.cron.phrase.caveat.domStepReset',
            values: { step: interval.step },
          });
        }
        if (state.times.length === 0 && !state.hourRange) {
          minute = '0';
          hour = '0';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.midnight' });
        }
        break;
      }
      case 'week': {
        if (dow === '*') {
          dow = '1';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.monday' });
        }
        if (state.times.length === 0) {
          minute = '0';
          hour = '0';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.midnight' });
        }
        break;
      }
      case 'month': {
        if (interval.step > 1) month = `*/${interval.step}`;
        if (dom === '*') {
          dom = '1';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.firstOfMonth' });
        }
        if (state.times.length === 0) {
          minute = '0';
          hour = '0';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.midnight' });
        }
        break;
      }
    }
  }

  if (!interval && state.hourRange) {
    // A bare window ("between 9 and 5 on weekdays") means hourly within it.
    hour = `${state.hourRange.start}-${state.hourRange.end}`;
    if (state.times.length === 0) {
      minute = '0';
      assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.minuteZero' });
    }
    assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.hourlyWindow' });
  }

  if (state.hourRange?.pmAssumed) {
    assumptions.push({
      key: 'utilities.tool.cron.phrase.assumption.pmWindowEnd',
      values: { end: state.hourRange.end - 12, shifted: state.hourRange.end },
    });
  }

  // Times only, no interval and no date anchor → a daily schedule.
  if (
    !interval &&
    !state.hourRange &&
    state.times.length > 0 &&
    dom === '*' &&
    dow === '*' &&
    month === '*'
  ) {
    assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.daily' });
  }

  // Weekday-only or date-only phrases still need a time.
  if (!interval && !state.hourRange && state.times.length === 0) {
    minute = '0';
    hour = '0';
    assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.midnight' });
  }

  if (dom !== '*' && dow !== '*') {
    caveats.push({ key: 'utilities.tool.cron.phrase.caveat.domDowUnion' });
  }

  return {
    ok: true,
    expression: `${minute} ${hour} ${dom} ${month} ${dow}`,
    assumptions,
    caveats,
  };
}
