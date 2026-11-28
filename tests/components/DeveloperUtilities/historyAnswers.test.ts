import { describe, expect, it } from 'vitest';
import { readHistoryAnswer, runTime, shortInput, timedFact } from '@/components/DeveloperUtilities/historyAnswers';
import { shortDigest } from '@/components/DeveloperUtilities/launcherPreviews';

const NOW = Date.UTC(2026, 10, 11, 13, 2, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const t = (key: string, options?: Record<string, unknown>) => {
  const name = key.split('.').pop() ?? key;
  if (options && 'when' in options) return `${name} ${String(options.when)}`;
  return options && 'count' in options ? `${name}:${String(options.count)}` : name;
};
const seconds = (ms: number) => Math.floor(ms / 1000);
const payload = (claims: Record<string, unknown>) => JSON.stringify(claims, null, 2);
const read = (id: Parameters<typeof readHistoryAnswer>[0], output: string, cut = false) => readHistoryAnswer(id, output, cut, t, 'en');

describe('history answers', () => {
  it('answers a JWT run with its subject and when it expires, read against now', () => {
    const live = read('jwt', payload({ sub: 'svc_deploy', exp: seconds(NOW + 2 * HOUR) }));
    expect(live).toMatchObject({ value: '"svc_deploy"', tone: 'string', timed: { kind: 'exp' } });
    expect(timedFact(live.timed!, NOW, t, 'en')).toBe('expIn in 2 hr.');
    const expired = read('jwt', payload({ sub: 'svc_billing', exp: seconds(NOW - 3 * DAY) }));
    expect(timedFact(expired.timed!, NOW, t, 'en')).toBe('expired 3 days ago');
    expect(read('jwt', payload({ sub: 'ci_runner' }))).toEqual({ value: '"ci_runner"', tone: 'string', fact: 'noExp', factTone: 'none' });
  });

  it('answers a JWT without a string subject with its claim count', () => {
    expect(read('jwt', payload({ sub: 42, role: 'admin' }))).toMatchObject({ value: '2 claims:2', tone: 'neutral' });
  });

  it('reads a timestamp run as its date and how long ago it is', () => {
    const answer = read('timestamp', new Date(NOW - 2 * DAY).toISOString());
    expect(answer.tone).toBe('date');
    expect(timedFact(answer.timed!, NOW, t, 'en')).toBe('2 days ago');
  });

  it('answers any other output with its head and size, quoting text and leaving structure bare', () => {
    expect(read('base64', 'TGluZ3Vh')).toEqual({ value: '"TGluZ3Vh"', tone: 'string', fact: '8 chars:8' });
    expect(read('json', '{\n  "a": 1\n}')).toEqual({ value: '{ "a": 1 }', tone: 'neutral', fact: '3 lines:3' });
    expect(read('number-base', '255')).toEqual({ value: '255', tone: 'number' });
    expect(read('color', '#00bfdf')).toEqual({ value: '#00bfdf', tone: 'neutral', swatch: '#00bfdf' });
  });

  it('marks an output the store cut short and names a run without output', () => {
    expect(read('base64', 'a'.repeat(30), true).fact).toBe('30+ chars:30');
    expect(read('jwt', '')).toEqual({ value: 'noOutput', tone: 'none' });
  });

  it('cuts a long value and falls back to text when a JWT output is not JSON', () => {
    const answer = read('jwt', 'x'.repeat(60));
    expect(answer.value).toBe(`"${'x'.repeat(23)}…"`);
    expect(answer.tone).toBe('string');
  });
});

describe('history rows', () => {
  it('shortens an input to its head and tail', () => {
    expect(shortInput('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.pR2Ys')).toBe('eyJhbGci…pR2Ys');
    expect(shortInput('short input')).toBe('short input');
    expect(shortInput('  two\n lines  ')).toBe('two lines');
  });

  it('shows the clock for a run today and the day for an older one', () => {
    expect(runTime(NOW - 60_000, NOW, 'en')).toMatch(/^\d{2}:\d{2}$/u);
    expect(runTime(NOW - 3 * DAY, NOW, 'en')).toMatch(/^Nov \d+$/u);
  });

  it('shortens a digest with the same head-and-tail rule', () => {
    expect(shortDigest('5f61e9aabbccddeeff00cabe')).toBe('5f61e9…cabe');
    expect(shortDigest('5f61e9cabe')).toBe('5f61e9cabe');
  });
});
