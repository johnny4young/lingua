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
  interval: { unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'; step: number } | null;
  intervalConflict: boolean;
  stepOutOfRange: { step: number; max: number } | null;
  weekdays: Set<number>;
  weekdayRange: { from: number; to: number } | null;
  nthWeekday: { day: number; nth: number | 'last' } | null;
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
  'fire',
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

/**
 * Spelled-out numbers people naturally write in schedules, both languages.
 * Spanish "once" (11) is deliberately absent: it collides with English
 * "once (a day)", so it is only honored in the unambiguous clock position
 * ("a las once"), rewritten before this map runs.
 */
const NUMBER_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\buno\b/g, '1'],
  [/\bdos\b/g, '2'],
  [/\btres\b/g, '3'],
  [/\bcuatro\b/g, '4'],
  [/\bcinco\b/g, '5'],
  [/\bseis\b/g, '6'],
  [/\bsiete\b/g, '7'],
  [/\bocho\b/g, '8'],
  [/\bnueve\b/g, '9'],
  [/\bdiez\b/g, '10'],
  [/\bdoce\b/g, '12'],
  [/\bone\b/g, '1'],
  [/\btwo\b/g, '2'],
  [/\bthree\b/g, '3'],
  [/\bfour\b/g, '4'],
  [/\bfive\b/g, '5'],
  [/\bsix\b/g, '6'],
  [/\bseven\b/g, '7'],
  [/\beight\b/g, '8'],
  [/\bnine\b/g, '9'],
  [/\bten\b/g, '10'],
  [/\beleven\b/g, '11'],
  [/\btwelve\b/g, '12'],
];

/** Lowercase, strip diacritics, collapse whitespace and stray punctuation. */
function normalize(phrase: string): string {
  let text = phrase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[.,;!?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  text = text.replace(/\ba las? once\b/gu, 'a las 11');
  for (const [regex, digit] of NUMBER_WORDS) {
    text = text.replace(regex, digit);
  }
  return text;
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
  if (!Number.isInteger(hour)) return null;
  if (meridiem) {
    // A meridiem-qualified clock reads 1-12; "13pm" and "0am" are not times
    // anyone says, so reject rather than reinterpret them as 24-hour values.
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return hour;
  }
  return hour >= 0 && hour <= 23 ? hour : null;
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
    // The inferred-PM shift must still land inside the day: "between 23 and
    // 12" would shift to 24, which no cron field can hold, so leave the pair
    // inverted and let the end<=start rejection below refuse the range.
    if (end < start && !m[4] && end <= 12 && end + 12 <= 23) {
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

  // Half/quarter past forms, both languages. These must run before the bare
  // "at N" pattern or it consumes the hour and strands "media"/"past".
  const halfQuarter: ReadonlyArray<readonly [RegExp, number]> = [
    [/\b(?:at\s+|a las?\s+)?(\d{1,2})\s+y\s+media\b/g, 30],
    [/\b(?:at\s+|a las?\s+)?(\d{1,2})\s+y\s+cuarto\b/g, 15],
    [/\bhalf past\s+(\d{1,2})\b/g, 30],
    [/\bquarter past\s+(\d{1,2})\b/g, 15],
  ];
  for (const [regex, minute] of halfQuarter) {
    runAll(regex, text, m => {
      if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
      const hour = toHour(m[1]!, undefined);
      if (hour === null) return;
      state.times.push({ hour, minute });
      consume(state, m.index, m.index + m[0].length);
    });
  }

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
  const unitOf = (word: string): 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | null => {
    if (/^min(?:s|uto?s?|utes?)?$/.test(word)) return 'minute';
    if (/^(?:hours?|horas?|hrs?|hs)$/.test(word)) return 'hour';
    if (/^(?:days?|dias?)$/.test(word)) return 'day';
    if (/^(?:weeks?|semanas?)$/.test(word)) return 'week';
    if (/^(?:months?|mes(?:es)?)$/.test(word)) return 'month';
    if (/^(?:years?|anos?|anios?)$/.test(word)) return 'year';
    return null;
  };

  // A step has to fit the cron field it lands in: */60 in the minute field
  // or */13 in the month field parse nowhere. Weeks are exempt here because
  // step>1 weeks gets its own, more useful unsupported explanation later.
  const FIELD_MAX: Record<'minute' | 'hour' | 'day' | 'month', number> = {
    minute: 59,
    hour: 23,
    day: 31,
    month: 12,
  };
  // "every other day" is a step of 2. Common enough that its absence reads as
  // a bug; several sibling libraries are documented as failing on it.
  runAll(/\b(?:every other|each other|cada dos)\s+([a-z]+)\b/g, text, m => {
    const unit = unitOf(m[1]!);
    if (!unit) return;
    state.interval = { unit, step: 2 };
    consume(state, m.index, m.index + m[0].length);
  });

  runAll(/\b(?:every|each|cada)\s+(?:(\d+)\s+)?([a-z]+)\b/g, text, m => {
    if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
    const unit = unitOf(m[2]!);
    if (!unit) return;
    const step = m[1] ? Number(m[1]) : 1;
    if (!Number.isInteger(step) || step < 1 || step > 999) return;
    if (unit !== 'week' && unit !== 'year' && step > FIELD_MAX[unit]) {
      state.stepOutOfRange = { step, max: FIELD_MAX[unit] };
      consume(state, m.index, m.index + m[0].length);
      return;
    }
    if (state.interval && (state.interval.unit !== unit || state.interval.step !== step)) {
      // "every 2 hours and every 3 days" is two competing cadences; keeping
      // either one silently would violate the faithfulness contract.
      state.intervalConflict = true;
      consume(state, m.index, m.index + m[0].length);
      return;
    }
    state.interval = { unit, step };
    consume(state, m.index, m.index + m[0].length);
  });

  if (!state.interval) {
    const singles: ReadonlyArray<readonly [RegExp, Extraction['interval']]> = [
      [/\b(?:every half hour|cada media hora)\b/g, { unit: 'minute', step: 30 }],
      // "once a day" reads as a plain daily schedule; "twice a day" is the
      // 12-hour cadence (00:00 and 12:00, or anchored to the given time).
      [/\b(?:once (?:a|per) (?:day|dia)|once daily)\b/g, { unit: 'day', step: 1 }],
      [/\b(?:once (?:a|per) week)\b/g, { unit: 'week', step: 1 }],
      [/\b(?:once (?:a|per) month)\b/g, { unit: 'month', step: 1 }],
      // Post-normalization forms: "dos veces" already reads "2 veces" here.
      [/\b(?:twice (?:a|per) (?:day|dia)|twice daily|2 veces al dia)\b/g, { unit: 'hour', step: 12 }],
      [/\b(?:una|1) vez al dia\b/g, { unit: 'day', step: 1 }],
      [/\b(?:hourly)\b/g, { unit: 'hour', step: 1 }],
      [/\b(?:daily|diario|diaria|diariamente|todos los dias)\b/g, { unit: 'day', step: 1 }],
      [/\b(?:weekly|semanal|semanalmente)\b/g, { unit: 'week', step: 1 }],
      [/\b(?:monthly|mensual|mensualmente)\b/g, { unit: 'month', step: 1 }],
      [/\b(?:quarterly|trimestral|trimestralmente|every quarter|cada trimestre)\b/g, { unit: 'month', step: 3 }],
      [/\b(?:yearly|annually|anual|anualmente)\b/g, { unit: 'year', step: 1 }],
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
  runAll(/\b(?:weekdays?|entre semana|dias? (?:habiles|laborables)|business days)\b/g, text, m => {
    state.weekdayRange = { from: 1, to: 5 };
    consume(state, m.index, m.index + m[0].length);
  });
  runAll(/\b(?:weekends?|fines? de semana)\b/g, text, m => {
    state.weekdays.add(6);
    state.weekdays.add(0);
    consume(state, m.index, m.index + m[0].length);
  });

  // "first monday of the month" / "last friday". Cron's day-of-month field
  // cannot express this at all, but the nth-weekday (5#1) and last-weekday
  // (5L) operators can — they are Quartz/Vixie extensions rather than POSIX,
  // so the result carries the same non-standard caveat "last day" does. This
  // has to run before the bare-name pass or it would only see "monday".
  const ORDINALS: ReadonlyArray<readonly [RegExp, number | 'last']> = [
    [/^(?:first|1st|primer|primero|primera)$/, 1],
    [/^(?:second|2nd|segundo|segunda)$/, 2],
    [/^(?:third|3rd|tercer|tercero|tercera)$/, 3],
    [/^(?:fourth|4th|cuarto|cuarta)$/, 4],
    [/^(?:fifth|5th|quinto|quinta)$/, 5],
    [/^(?:last|ultimo|ultima)$/, 'last'],
  ];
  const ordinalWord =
    '(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|ultim[oa])';

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
  const nthRe = new RegExp(
    `\\b(${ordinalWord})\\s+(${dayWord})(\\s+(?:of (?:the |every |each )?month|de cada mes|del mes))?\\b`,
    'g'
  );
  runAll(nthRe, text, m => {
    const day = dayNumber(m[2]!);
    if (day === null) return;
    const nth = ORDINALS.find(([re]) => re.test(m[1]!))?.[1];
    if (nth === undefined) return;
    state.nthWeekday = { day, nth };
    consume(state, m.index, m.index + m[0].length);
  });

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

  // Bare English ordinals ("every 25th", "the 1st and 15th", "3rd of January").
  // The suffix itself disambiguates a date from a clock hour, so no lead-in
  // phrase is required — unlike the Spanish "el 15", handled below.
  runAll(/\b(\d{1,2})(?:st|nd|rd|th)(\s+of (?:the |every |each )?month)?\b/g, text, m => {
    if (state.spans.some(([s, e]) => m.index >= s && m.index < e)) return;
    const day = Number(m[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    state.monthDays.push(day);
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
  if (state.nthWeekday) {
    const { day, nth } = state.nthWeekday;
    return nth === 'last' ? `${day}L` : `${day}#${nth}`;
  }
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
    intervalConflict: false,
    stepOutOfRange: null,
    weekdays: new Set(),
    weekdayRange: null,
    nthWeekday: null,
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

  // Out-of-range and conflicting cadences must win over "nothing found":
  // both consumed their spans, so without this they would fall through to
  // the generic unrecognized result and lose their explanation.
  if (state.stepOutOfRange) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: {
        key: 'utilities.tool.cron.phrase.unsupported.stepOutOfRange',
        values: { step: state.stepOutOfRange.step, max: state.stepOutOfRange.max },
      },
    };
  }
  if (state.intervalConflict) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: { key: 'utilities.tool.cron.phrase.unsupported.conflictingIntervals' },
    };
  }

  const anythingExtracted =
    state.times.length > 0 ||
    state.hourRange !== null ||
    state.interval !== null ||
    state.weekdays.size > 0 ||
    state.weekdayRange !== null ||
    state.nthWeekday !== null ||
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
  if (state.nthWeekday) {
    caveats.push({
      key:
        state.nthWeekday.nth === 'last'
          ? 'utilities.tool.cron.phrase.caveat.nonstandardLastWeekday'
          : 'utilities.tool.cron.phrase.caveat.nonstandardNthWeekday',
    });
  }

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
        if (interval.step > 1 && 60 % interval.step !== 0) {
          caveats.push({
            key: 'utilities.tool.cron.phrase.caveat.minuteStepUneven',
            values: { step: interval.step, tail: 60 % interval.step },
          });
        }
        if (state.times.length > 0) {
          // "every 5 minutes at 8am" reads as: within hour 8.
          hour = [...new Set(state.times.map(t => t.hour))].sort((a, b) => a - b).join(',');
        }
        if (state.hourRange) hour = `${state.hourRange.start}-${state.hourRange.end}`;
        break;
      }
      case 'hour': {
        hour = interval.step === 1 ? '*' : `*/${interval.step}`;
        if (interval.step > 1 && 24 % interval.step !== 0) {
          caveats.push({
            key: 'utilities.tool.cron.phrase.caveat.hourStepUneven',
            values: { step: interval.step, tail: 24 % interval.step },
          });
        }
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
      case 'year': {
        // Cron has no year field; a yearly cadence is January 1st.
        if (month === '*') {
          month = '1';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.january' });
        }
        if (dom === '*') {
          dom = '1';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.firstOfMonth' });
        }
        if (interval.step > 1) {
          caveats.push({
            key: 'utilities.tool.cron.phrase.caveat.noYearField',
            values: { step: interval.step },
          });
        }
        if (state.times.length === 0) {
          minute = '0';
          hour = '0';
          assumptions.push({ key: 'utilities.tool.cron.phrase.assumption.midnight' });
        }
        break;
      }
      case 'month': {
        if (interval.step > 1) {
          month = `*/${interval.step}`;
          if (12 % interval.step !== 0) {
            caveats.push({
              key: 'utilities.tool.cron.phrase.caveat.monthStepUneven',
              values: { step: interval.step, tail: 12 % interval.step },
            });
          }
        }
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
