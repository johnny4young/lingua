/**
 * Unit tests for the {{var}} substitution helper .
 *
 * Pin: substitution semantics, missing-var error, type-safety on
 * non-string values, whitespace tolerance inside braces, and the
 * tagged-union variant for callers that want to handle the missing
 * branch without try/catch.
 */

import { describe, expect, it } from 'vitest';
import { renderTemplate, renderTemplateResult } from '../../src/lib/renderTemplate';

describe('renderTemplate', () => {
  it('substitutes a single variable', () => {
    expect(renderTemplate('Hi {{name}}!', { name: 'Lingua' })).toBe('Hi Lingua!');
  });

  it('substitutes multiple variables', () => {
    expect(
      renderTemplate('Hi {{name}}, your {{tier}} expires {{when}}.', {
        name: 'Maria',
        tier: 'Pro',
        when: '2026-06-29',
      })
    ).toBe('Hi Maria, your Pro expires 2026-06-29.');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ name }}!', { name: 'Lingua' })).toBe('Hi Lingua!');
  });

  it('substitutes the same variable in multiple positions', () => {
    expect(
      renderTemplate('{{name}} for {{name}}', { name: 'me' })
    ).toBe('me for me');
  });

  it('throws on missing variable so typos surface in tests', () => {
    expect(() =>
      renderTemplate('Hi {{naem}}!', { name: 'Lingua' })
    ).toThrowError(/missing variable "naem"/);
  });

  it('throws on non-string value', () => {
    expect(() =>
      renderTemplate('Hi {{name}}!', { name: 42 as unknown as string })
    ).toThrowError(/is not a string/);
  });

  it('does not escape HTML — values with markup pass through verbatim', () => {
    // Documented behaviour: callers that need escape do so themselves.
    expect(renderTemplate('{{x}}', { x: '<b>bold</b>' })).toBe('<b>bold</b>');
  });
});

describe('renderTemplateResult', () => {
  it('returns ok:true with html on success', () => {
    expect(renderTemplateResult('Hi {{x}}', { x: 'y' })).toEqual({ ok: true, html: 'Hi y' });
  });

  it('returns ok:false with the missing var name on failure', () => {
    expect(renderTemplateResult('Hi {{naem}}', { name: 'Lingua' })).toEqual({
      ok: false,
      missing: 'naem',
    });
  });
});
