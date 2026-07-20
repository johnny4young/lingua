/**
 * internal — Unit tests for `parseCronExpression`. Covers happy-path
 * expressions in both locales, next-run counting, reference-date
 * determinism, and the three error branches (empty / invalid / iteration).
 *
 * The helper itself is async because it lazy-imports `cron-parser` and
 * the `cronstrue` i18n bundle; vitest awaits without special setup.
 */

import { describe, expect, it } from 'vitest';
import {
  CRON_PARSER_MAX_NEXT,
  parseCronExpression,
} from '../../src/renderer/utils/cronParser';

const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

describe('parseCronExpression', () => {
  it('parses an every-5-minutes expression and produces an English explanation', async () => {
    const result = await parseCronExpression('*/5 * * * *', {
      locale: 'en',
      nextCount: 3,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.description.toLowerCase()).toContain('every 5 minutes');
    expect(result.nextRuns).toHaveLength(3);
    expect(result.nextRuns[0]?.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    // Each successive run is strictly later than the previous one.
    for (let index = 1; index < result.nextRuns.length; index += 1) {
      const previous = result.nextRuns[index - 1];
      const current = result.nextRuns[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous && current) {
        expect(current.getTime()).toBeGreaterThan(previous.getTime());
      }
    }
  });

  it('translates the description to Spanish when locale is es', async () => {
    const result = await parseCronExpression('*/5 * * * *', {
      locale: 'es',
      nextCount: 1,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The Spanish cronstrue locale emits "Cada" for "every".
    expect(result.description.toLowerCase()).toContain('cada 5 minutos');
  });

  it('understands cron nicknames like @daily', async () => {
    const result = await parseCronExpression('@daily', {
      locale: 'en',
      nextCount: 2,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The first run is the next midnight strictly after FIXED_NOW;
    // FIXED_NOW is already midnight, so run 0 is the *next* day.
    expect(result.nextRuns[0]?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(result.nextRuns[1]?.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });

  it('supports 6-field expressions with seconds', async () => {
    const result = await parseCronExpression('0 */15 * * * *', {
      locale: 'en',
      nextCount: 2,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextRuns).toHaveLength(2);
    // Second run lands 15 minutes after the first.
    expect(result.nextRuns[1]!.getTime() - result.nextRuns[0]!.getTime()).toBe(15 * 60 * 1000);
  });

  it('rejects 7-field Quartz-style expressions because cron-parser supports up to seconds only', async () => {
    const result = await parseCronExpression('0 0 12 * * * 2026', {
      locale: 'en',
      nextCount: 1,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.cron.error.invalid');
    expect(result.message).toContain('too many fields');
  });

  it('rejects empty input with the empty error key and no message', async () => {
    const result = await parseCronExpression('   ', {
      locale: 'en',
      nextCount: 5,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result).toEqual({ ok: false, errorKey: 'utilities.tool.cron.error.empty' });
  });

  it('rejects malformed cron expressions with the invalid error key plus a raw message', async () => {
    const result = await parseCronExpression('not a cron', {
      locale: 'en',
      nextCount: 5,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.cron.error.invalid');
    expect(result.message).toBeTruthy();
  });

  it('clamps nextCount to CRON_PARSER_MAX_NEXT', async () => {
    const result = await parseCronExpression('*/1 * * * *', {
      locale: 'en',
      nextCount: CRON_PARSER_MAX_NEXT + 42,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextRuns).toHaveLength(CRON_PARSER_MAX_NEXT);
  });

  it('clamps a non-finite nextCount up to 1', async () => {
    const result = await parseCronExpression('*/5 * * * *', {
      locale: 'en',
      nextCount: Number.NaN,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextRuns).toHaveLength(1);
  });

  it('handles list and range fields like 0 0,12 * * 1-5', async () => {
    const result = await parseCronExpression('0 0,12 * * 1-5', {
      locale: 'en',
      nextCount: 4,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // FIXED_NOW is 2026-01-01 which is a Thursday. First run after
    // midnight on Thursday is 12:00 the same day.
    expect(result.nextRuns[0]?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    // Friday midnight is next.
    expect(result.nextRuns[1]?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('rejects impossible expressions like Feb 31 at parse time with the invalid error key', async () => {
    // cron-parser 5.x validates day-of-month against the month list up front
    // and refuses to construct the iterator. The helper surfaces it as the
    // same `error.invalid` branch any other malformed input uses, so the
    // panel copy stays consistent.
    const result = await parseCronExpression('0 0 31 2 *', {
      locale: 'en',
      nextCount: 5,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.cron.error.invalid');
    expect(result.message).toBeTruthy();
  });

  it('translates the @monthly nickname description to Spanish', async () => {
    const result = await parseCronExpression('@monthly', {
      locale: 'es',
      nextCount: 1,
      now: FIXED_NOW,
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.description).toBeTruthy();
    // The description must not be the English fallback string.
    expect(result.description.toLowerCase()).not.toContain('every month');
  });

  it('never returns past runs relative to the provided now', async () => {
    const result = await parseCronExpression('0 0 * * *', {
      locale: 'en',
      nextCount: 10,
      now: new Date('2030-06-15T12:34:56Z'),
      tz: 'UTC',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const run of result.nextRuns) {
      expect(run.getTime()).toBeGreaterThan(new Date('2030-06-15T12:34:56Z').getTime());
    }
  });
});
