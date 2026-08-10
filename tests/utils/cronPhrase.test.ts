import { describe, expect, it } from 'vitest';

import { phraseToCron } from '../../src/renderer/utils/cronPhrase';
import { parseCronExpression } from '../../src/renderer/utils/cronParser';

/**
 * The engine's contract has four legs, and the matrix below exercises each:
 *
 * 1. Faithfulness — the expression reflects every scheduling token, and a
 *    phrase with tokens the engine cannot consume FAILS instead of guessing.
 * 2. Transparent defaults — filled gaps surface as assumption keys.
 * 3. Honest impossibilities — intents cron cannot express return typed
 *    unsupported failures, never a wrong approximation.
 * 4. The classic gotchas — day-of-month steps and DOM+DOW union — arrive as
 *    caveat keys.
 *
 * Every accepted expression additionally round-trips through the real parser
 * (cron-parser via parseCronExpression), so the engine can never emit a
 * string the rest of the panel would reject.
 */

const K = 'utilities.tool.cron.phrase';

interface OkCase {
  readonly phrase: string;
  readonly expression: string;
  readonly assumptions?: readonly string[];
  readonly caveats?: readonly string[];
}

const OK_CASES: readonly OkCase[] = [
  // ---- the motivating example, both languages -------------------------
  {
    phrase: 'cron cada 3 dias 8am',
    expression: '0 8 */3 * *',
    caveats: [`${K}.caveat.domStepReset`],
  },
  {
    phrase: 'cada 3 días a las 8am',
    expression: '0 8 */3 * *',
    caveats: [`${K}.caveat.domStepReset`],
  },
  {
    phrase: 'every 3 days at 8am',
    expression: '0 8 */3 * *',
    caveats: [`${K}.caveat.domStepReset`],
  },

  // ---- minute and hour intervals --------------------------------------
  { phrase: 'cada 15 minutos', expression: '*/15 * * * *' },
  { phrase: 'every minute', expression: '* * * * *' },
  {
    phrase: 'every 15 minutes between 9 and 5',
    expression: '*/15 9-17 * * *',
    assumptions: [`${K}.assumption.pmWindowEnd`],
  },
  { phrase: 'cada 30 minutos de 9 a 17', expression: '*/30 9-17 * * *' },
  {
    phrase: 'cada hora',
    expression: '0 * * * *',
    assumptions: [`${K}.assumption.minuteZero`],
  },
  {
    phrase: 'hourly',
    expression: '0 * * * *',
    assumptions: [`${K}.assumption.minuteZero`],
  },
  {
    phrase: 'cada 2 horas entre las 9 y las 17',
    expression: '0 9-17/2 * * *',
    assumptions: [`${K}.assumption.minuteZero`],
  },
  { phrase: 'cada 5 minutos los lunes', expression: '*/5 * * * 1' },

  // ---- plain times → daily schedules ----------------------------------
  {
    phrase: 'a las 8',
    expression: '0 8 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  {
    phrase: '8am y 8pm',
    expression: '0 8,20 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  { phrase: 'daily at noon', expression: '0 12 * * *' },
  { phrase: 'todos los dias a las 7', expression: '0 7 * * *' },
  { phrase: 'diario a medianoche', expression: '0 0 * * *' },

  // ---- weekdays --------------------------------------------------------
  { phrase: 'lunes a viernes a las 9', expression: '0 9 * * 1-5' },
  { phrase: 'weekdays at 9:30', expression: '30 9 * * 1-5' },
  { phrase: 'los lunes y jueves a las 7', expression: '0 7 * * 1,4' },
  { phrase: 'fines de semana a mediodia', expression: '0 12 * * 0,6' },
  { phrase: 'miércoles a las 14:30', expression: '30 14 * * 3' },
  {
    phrase: 'entre semana',
    expression: '0 0 * * 1-5',
    assumptions: [`${K}.assumption.midnight`],
  },

  // ---- weekly / monthly ------------------------------------------------
  {
    phrase: 'weekly',
    expression: '0 0 * * 1',
    assumptions: [`${K}.assumption.monday`, `${K}.assumption.midnight`],
  },
  { phrase: 'cada semana los viernes a las 5pm', expression: '0 17 * * 5' },
  {
    phrase: 'monthly',
    expression: '0 0 1 * *',
    assumptions: [`${K}.assumption.firstOfMonth`, `${K}.assumption.midnight`],
  },
  { phrase: 'el 15 de cada mes a las 6am', expression: '0 6 15 * *' },
  { phrase: 'on the 1st at 6am', expression: '0 6 1 * *' },
  {
    phrase: 'cada 3 meses el 1st a las 9',
    expression: '0 9 1 */3 *',
  },
  {
    phrase: 'ultimo dia del mes a las 23:45',
    expression: '45 23 L * *',
    caveats: [`${K}.caveat.nonstandardLast`],
  },

  // ---- months ----------------------------------------------------------
  { phrase: 'sundays at 10am in january', expression: '0 10 * 1 0' },
  {
    phrase: 'first day of january at 8am',
    expression: '0 8 1 1 *',
  },

  // ---- DOM + DOW union caveat -----------------------------------------
  {
    phrase: 'on the 15th and mondays at 8am',
    expression: '0 8 15 * 1',
    caveats: [`${K}.caveat.domDowUnion`],
  },

  // ---- uneven steps get reset caveats ---------------------------------
  {
    phrase: 'every 40 minutes',
    expression: '*/40 * * * *',
    caveats: [`${K}.caveat.minuteStepUneven`],
  },
  { phrase: 'cada 30 minutos', expression: '*/30 * * * *' },
  {
    phrase: 'every 5 hours',
    expression: '0 */5 * * *',
    assumptions: [`${K}.assumption.minuteZero`],
    caveats: [`${K}.caveat.hourStepUneven`],
  },
  {
    phrase: 'cada 2 horas',
    expression: '0 */2 * * *',
    assumptions: [`${K}.assumption.minuteZero`],
  },
  {
    phrase: 'cada 5 meses el 1st a las 9',
    expression: '0 9 1 */5 *',
    caveats: [`${K}.caveat.monthStepUneven`],
  },

  // ---- grammar expansion: number words, half/quarter, once/twice ------
  {
    phrase: 'cada dos dias a las 8',
    expression: '0 8 */2 * *',
    caveats: [`${K}.caveat.domStepReset`],
  },
  { phrase: 'every ten minutes', expression: '*/10 * * * *' },
  {
    phrase: 'de nueve a cinco cada 30 minutos',
    expression: '*/30 9-17 * * *',
    assumptions: [`${K}.assumption.pmWindowEnd`],
  },
  {
    phrase: 'a las ocho y media',
    expression: '30 8 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  {
    phrase: 'half past 8',
    expression: '30 8 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  { phrase: 'quarter past 9 on weekdays', expression: '15 9 * * 1-5' },
  {
    phrase: 'a las once',
    expression: '0 11 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  {
    phrase: 'a las dos y cuarto',
    expression: '15 2 * * *',
    assumptions: [`${K}.assumption.daily`],
  },
  {
    phrase: 'once a day',
    expression: '0 0 * * *',
    assumptions: [`${K}.assumption.midnight`],
  },
  { phrase: 'once a day at 6am', expression: '0 6 * * *' },
  {
    phrase: 'twice a day',
    expression: '0 */12 * * *',
    assumptions: [`${K}.assumption.minuteZero`],
  },
  {
    phrase: 'una vez al dia a las 7',
    expression: '0 7 * * *',
  },
  { phrase: 'cada media hora', expression: '*/30 * * * *' },
  {
    phrase: 'once a week',
    expression: '0 0 * * 1',
    assumptions: [`${K}.assumption.monday`, `${K}.assumption.midnight`],
  },

  // ---- grammar drawn from sibling open-source parsers -------------------
  // These phrases come from the documented vocabularies of english-to-cron,
  // cron-talk and natural-cron-expression. Running their corpus through this
  // engine is what surfaced each gap below.
  {
    phrase: 'every year',
    expression: '0 0 1 1 *',
    assumptions: [
      `${K}.assumption.january`,
      `${K}.assumption.firstOfMonth`,
      `${K}.assumption.midnight`,
    ],
  },
  {
    phrase: 'annually',
    expression: '0 0 1 1 *',
    assumptions: [
      `${K}.assumption.january`,
      `${K}.assumption.firstOfMonth`,
      `${K}.assumption.midnight`,
    ],
  },
  {
    phrase: 'anualmente',
    expression: '0 0 1 1 *',
    assumptions: [
      `${K}.assumption.january`,
      `${K}.assumption.firstOfMonth`,
      `${K}.assumption.midnight`,
    ],
  },
  {
    phrase: 'every quarter',
    expression: '0 0 1 */3 *',
    assumptions: [`${K}.assumption.firstOfMonth`, `${K}.assumption.midnight`],
  },
  // Bare ordinals: the suffix marks a date, so no "on the" lead-in is needed.
  {
    phrase: 'every 25th',
    expression: '0 0 25 * *',
    assumptions: [`${K}.assumption.midnight`],
  },
  {
    phrase: 'every 3rd of January',
    expression: '0 0 3 1 *',
    assumptions: [`${K}.assumption.midnight`],
  },
  {
    phrase: 'the 1st and 15th of the month',
    expression: '0 0 1,15 * *',
    assumptions: [`${K}.assumption.midnight`],
  },
  {
    phrase: 'every other day',
    expression: '0 0 */2 * *',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.domStepReset`],
  },
  {
    phrase: 'cada dos dias',
    expression: '0 0 */2 * *',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.domStepReset`],
  },
  // nth/last weekday: cron's day-of-month field cannot express these, but the
  // Quartz # and L operators can — hence the non-standard caveat.
  {
    phrase: 'first monday of the month',
    expression: '0 0 * * 1#1',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.nonstandardNthWeekday`],
  },
  {
    phrase: 'last friday of the month',
    expression: '0 0 * * 5L',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.nonstandardLastWeekday`],
  },
  {
    phrase: 'primer lunes del mes',
    expression: '0 0 * * 1#1',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.nonstandardNthWeekday`],
  },
  {
    phrase: 'ultimo viernes del mes',
    expression: '0 0 * * 5L',
    assumptions: [`${K}.assumption.midnight`],
    caveats: [`${K}.caveat.nonstandardLastWeekday`],
  },
  // "cada quincena" is the Spanish payroll idiom. Unlike "cada 2 semanas" it
  // HAS an exact cron form — the 1st and the 15th — so it must be accepted,
  // not refused; the notes carry the reading and the uneven gap.
  {
    phrase: 'cada quincena',
    expression: '0 0 1,15 * *',
    assumptions: [`${K}.assumption.semiMonthly`, `${K}.assumption.midnight`],
    caveats: [`${K}.caveat.semiMonthlyGap`],
  },
  {
    phrase: 'quincenalmente',
    expression: '0 0 1,15 * *',
    assumptions: [`${K}.assumption.semiMonthly`, `${K}.assumption.midnight`],
    caveats: [`${K}.caveat.semiMonthlyGap`],
  },
  {
    phrase: 'cada quincena a las 8am',
    expression: '0 8 1,15 * *',
    assumptions: [`${K}.assumption.semiMonthly`],
    caveats: [`${K}.caveat.semiMonthlyGap`],
  },
  {
    phrase: 'twice a month',
    expression: '0 0 1,15 * *',
    assumptions: [`${K}.assumption.semiMonthly`, `${K}.assumption.midnight`],
    caveats: [`${K}.caveat.semiMonthlyGap`],
  },
  {
    phrase: 'semi-monthly',
    expression: '0 0 1,15 * *',
    assumptions: [`${K}.assumption.semiMonthly`, `${K}.assumption.midnight`],
    caveats: [`${K}.caveat.semiMonthlyGap`],
  },
  { phrase: 'each day at 6am', expression: '0 6 * * *' },
  { phrase: 'every weekday at 9', expression: '0 9 * * 1-5' },

  // ---- windows without an interval ------------------------------------
  {
    phrase: 'weekdays between 9 and 5',
    expression: '0 9-17 * * 1-5',
    assumptions: [
      `${K}.assumption.minuteZero`,
      `${K}.assumption.hourlyWindow`,
      `${K}.assumption.pmWindowEnd`,
    ],
  },
];

describe('phraseToCron — accepted phrases', () => {
  for (const testCase of OK_CASES) {
    it(`"${testCase.phrase}" → ${testCase.expression}`, () => {
      const result = phraseToCron(testCase.phrase);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.expression).toBe(testCase.expression);
      expect(result.assumptions.map(note => note.key)).toEqual(testCase.assumptions ?? []);
      expect(result.caveats.map(note => note.key)).toEqual(testCase.caveats ?? []);
    });
  }

  it('round-trips every accepted expression through the real parser', async () => {
    for (const testCase of OK_CASES) {
      const result = phraseToCron(testCase.phrase);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const parsed = await parseCronExpression(result.expression, {
        locale: 'en',
        nextCount: 3,
        now: new Date('2026-08-10T12:00:00Z'),
        tz: 'UTC',
      });
      expect(parsed.ok, `${testCase.phrase} → ${result.expression}`).toBe(true);
    }
  });
});

describe('phraseToCron — honest failures', () => {
  it('rejects the empty phrase', () => {
    expect(phraseToCron('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('fails a phrase with tokens it cannot consume instead of guessing', () => {
    const result = phraseToCron('deploy the flux capacitor at 8am');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unrecognized');
    expect(result.leftover).toEqual(['deploy', 'flux', 'capacitor']);
  });

  it('fails when nothing schedulable was found', () => {
    const result = phraseToCron('cron job please');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unrecognized');
    expect(result.leftover).toEqual([]);
  });

  it('refuses a continuous every-2-weeks instead of approximating it', () => {
    const result = phraseToCron('cada 2 semanas a las 8');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(result.detail?.key).toBe(`${K}.unsupported.multiWeek`);
  });

  it('refuses mixed-minute times a single expression cannot express', () => {
    // 8:15 and 20:30 as one expression would be minute 15,30 × hour 8,20 —
    // firing at 8:30 and 20:15 too. The engine says so instead of shipping it.
    const result = phraseToCron('a las 8:15 y a las 20:30');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(result.detail?.key).toBe(`${K}.unsupported.mixedTimes`);
  });

  it('rejects meridiem-qualified clocks outside 1-12 instead of reading them as 24h', () => {
    expect(phraseToCron('at 13pm').ok).toBe(false);
    expect(phraseToCron('at 0am').ok).toBe(false);
  });

  it('refuses a window whose inferred-pm end would leave the day', () => {
    // 12 + 12 = 24 fits no cron hour field; the range is rejected rather
    // than emitted as 23-24 for the downstream parser to choke on.
    expect(phraseToCron('every 15 minutes between 23 and 12').ok).toBe(false);
  });

  it('refuses steps that do not fit their cron field, naming the maximum', () => {
    for (const [phrase, max] of [
      ['every 60 minutes', 59],
      ['every 24 hours', 23],
      ['every 32 days', 31],
      ['every 13 months', 12],
    ] as const) {
      const result = phraseToCron(phrase);
      expect(result.ok, phrase).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('unsupported');
      expect(result.detail?.key).toBe(`${K}.unsupported.stepOutOfRange`);
      expect(result.detail?.values).toMatchObject({ max });
    }
  });

  it('refuses competing intervals instead of silently keeping one', () => {
    const result = phraseToCron('every 2 hours every 3 days');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    expect(result.detail?.key).toBe(`${K}.unsupported.conflictingIntervals`);
  });

  it('rejects out-of-range clock values rather than clamping them', () => {
    const result = phraseToCron('at 25:00');
    expect(result.ok).toBe(false);
  });
});
