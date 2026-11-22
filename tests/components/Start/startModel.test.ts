import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { BUILT_IN_TEMPLATES } from '@/data/templates';
import { START_LANGUAGES, languageAvailability, startTimeAgo, templateRows } from '@/components/Start/startModel';

const NOW = new Date(2026, 10, 21, 15, 0).getTime();
const HOUR = 3_600_000;

describe('startModel', () => {
  it('reads an answer age in minutes, hours, yesterday, a weekday, then a date', () => {
    expect(startTimeAgo(NOW - 20_000, NOW, 'en')).toBe('now');
    expect(startTimeAgo(NOW - 5 * 60_000, NOW, 'en')).toBe('5 min. ago');
    expect(startTimeAgo(NOW - 2 * HOUR, NOW, 'en')).toBe('2 hr. ago');
    expect(startTimeAgo(NOW - 26 * HOUR, NOW, 'en')).toBe('yesterday');
    expect(startTimeAgo(new Date(2026, 10, 17, 9).getTime(), NOW, 'en')).toBe('Tuesday');
    expect(startTimeAgo(new Date(2026, 9, 2).getTime(), NOW, 'en')).toBe('Oct 2');
    expect(startTimeAgo(NOW - 26 * HOUR, NOW, 'es')).toBe('ayer');
  });

  it('lists the languages that run on their own before the ones that need a toolchain', () => {
    expect(START_LANGUAGES.slice(-2)).toEqual(['go', 'rust']);
    expect(START_LANGUAGES).toContain('lua');
    expect(START_LANGUAGES).not.toContain('json');
  });

  it('says how a language runs on each build', () => {
    expect(languageAvailability('python', true, null)).toEqual({ kind: 'browser' });
    expect(languageAvailability('python', false, null)).toEqual({ kind: 'offline' });
    expect(languageAvailability('go', true, 'installed')).toEqual({ kind: 'desktopOnly' });
    expect(languageAvailability('rust', false, 'missing')).toEqual({ kind: 'toolchain', status: 'missing' });
  });

  it('groups templates that share a title and keeps every template reachable', () => {
    const rows = templateRows(BUILT_IN_TEMPLATES, i18next.t, null);
    expect(rows.flatMap(row => row.templates)).toHaveLength(BUILT_IN_TEMPLATES.length);
    expect(rows.find(row => row.label === 'Hello World')?.templates.length).toBeGreaterThan(1);
    const python = templateRows(BUILT_IN_TEMPLATES, i18next.t, 'python');
    expect(python.every(row => row.templates.every(template => template.language === 'python'))).toBe(true);
  });
});
