import { describe, expect, it } from 'vitest';
import { explainError, formatExplanation } from '../../src/shared/errorExplainer';

describe('explainError', () => {
  it('explains JS ReferenceError with the identifier name', () => {
    const e = explainError({ message: 'ReferenceError: foo is not defined', language: 'javascript' });
    expect(e.matched).toBe(true);
    expect(e.title).toContain('foo');
    expect(e.hints.length).toBeGreaterThan(0);
  });

  it('explains reading a property of undefined', () => {
    const e = explainError({
      message: "TypeError: Cannot read properties of undefined (reading 'name')",
      language: 'javascript',
    });
    expect(e.matched).toBe(true);
    expect(e.title.toLowerCase()).toContain('undefined');
    expect(e.hints.some((h) => h.includes('?.'))).toBe(true);
  });

  it('explains is-not-a-function', () => {
    const e = explainError({ message: 'TypeError: obj.doThing is not a function', language: 'typescript' });
    expect(e.matched).toBe(true);
    expect(e.title).toContain('obj.doThing');
  });

  it('explains stack overflow', () => {
    const e = explainError({ message: 'RangeError: Maximum call stack size exceeded', language: 'javascript' });
    expect(e.matched).toBe(true);
    expect(e.title.toLowerCase()).toContain('recursion');
  });

  it('explains Python NameError with the name', () => {
    const e = explainError({ message: "NameError: name 'total' is not defined", language: 'python' });
    expect(e.matched).toBe(true);
    expect(e.title).toContain('total');
  });

  it('explains Python ModuleNotFoundError', () => {
    const e = explainError({ message: "ModuleNotFoundError: No module named 'requests'", language: 'python' });
    expect(e.matched).toBe(true);
    expect(e.title).toContain('requests');
  });

  it('explains Ruby NoMethodError', () => {
    const e = explainError({ message: "undefined method `foo' for nil:NilClass", language: 'ruby' });
    expect(e.matched).toBe(true);
    expect(e.title).toContain('foo');
    expect(e.hints.some((h) => h.includes('&.'))).toBe(true);
  });

  it('does not apply JS rules to Python and vice versa', () => {
    // A JS-style message under python should not match the JS "is not defined" rule.
    const e = explainError({ message: 'foo is not defined', language: 'python' });
    // The Python NameError rule requires the "NameError:" prefix, so this
    // falls through to the generic explanation rather than a JS match.
    expect(e.matched).toBe(false);
    expect(e.title).toBe('Runtime error');
  });

  it('returns a generic explanation for unknown errors', () => {
    const e = explainError({ message: 'Something totally unexpected happened', language: 'javascript' });
    expect(e.matched).toBe(false);
    expect(e.explanation.length).toBeGreaterThan(0);
    expect(e.hints.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const e = explainError({ message: '   ', language: 'javascript' });
    expect(e.matched).toBe(false);
    expect(e.title).toBe('No error message');
  });

  it('formats an explanation into a readable block with bullets', () => {
    const text = formatExplanation(
      explainError({ message: 'ReferenceError: x is not defined', language: 'javascript' })
    );
    expect(text).toContain('x');
    expect(text).toContain('•');
    expect(text.split('\n').length).toBeGreaterThan(2);
  });
});
