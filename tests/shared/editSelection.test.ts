import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  buildEditSelectionRequest,
  MAX_EDIT_INSTRUCTION_CHARS,
  readEditAnswer,
  REDACTED_MARK,
} from '../../src/shared/ai/editSelection';

const code = 'const a = 1;\nconst b = a + 1;\nconsole.log(b);\n';
const start = code.indexOf('const b');
const end = code.indexOf('\nconsole');

describe('buildEditSelectionRequest', () => {
  it('marks the selection inside the whole file and states the change', () => {
    const request = buildEditSelectionRequest({ code, start, end, instruction: '  use let  ', language: 'javascript', filename: 'a.js' });
    const user = request.messages[1]!.content;
    expect(user).toContain('Language: javascript (a.js)');
    expect(user).toContain('Change: use let\n');
    expect(user).toContain('const a = 1;\n<<<SELECTION>>>const b = a + 1;<<<END SELECTION>>>\nconsole.log(b);');
    expect(request.messages[0]!.role).toBe('system');
    expect(request.preview).toContain('<<<SELECTION>>>');
    expect(request.model).toBeUndefined();
  });

  it('carries the model and the answer language when given', () => {
    const request = buildEditSelectionRequest({ code, start, end, instruction: 'x', language: 'javascript', model: 'qwen', answerLanguage: 'Spanish' });
    expect(request.model).toBe('qwen');
    expect(request.messages[1]!.content).toContain('Spanish');
  });

  it('caps the instruction', () => {
    const request = buildEditSelectionRequest({ code, start, end, instruction: 'y'.repeat(MAX_EDIT_INSTRUCTION_CHARS + 50), language: 'javascript' });
    expect(request.messages[1]!.content).toContain(`Change: ${'y'.repeat(MAX_EDIT_INSTRUCTION_CHARS)}\n`);
    expect(request.messages[1]!.content).not.toContain('y'.repeat(MAX_EDIT_INSTRUCTION_CHARS + 1));
  });

  it('sends only the lines around the selection for a large file', () => {
    const lines = Array.from({ length: 1_000 }, (_, index) => `const line${index} = ${index};`);
    const big = lines.join('\n');
    const from = big.indexOf('const line500 ');
    const to = from + lines[500]!.length;
    const user = buildEditSelectionRequest({ code: big, start: from, end: to, instruction: 'x', language: 'javascript' }).messages[1]!.content;
    expect(user).toContain('<<<SELECTION>>>const line500 = 500;<<<END SELECTION>>>');
    expect(user).toContain('const line440 = 440;');
    expect(user).not.toContain('const line439 = 439;');
    expect(user).toContain('const line560 = 560;');
    expect(user).not.toContain('const line561 = 561;');
    expect(user).toContain('…\nconst line440');
  });

  it('windows on the selection even when earlier lines hold the marker text', () => {
    const lines = Array.from({ length: 1_000 }, (_, index) => (index === 3 ? "const tag = '<<<SELECTION>>>';" : `const line${index} = ${index};`));
    const big = lines.join('\n');
    const from = big.indexOf('const line800 ');
    const user = buildEditSelectionRequest({ code: big, start: from, end: from + lines[800]!.length, instruction: 'x', language: 'javascript' }).messages[1]!.content;
    expect(user).toContain('const line740 = 740;');
    expect(user).not.toContain('const line739 = 739;');
  });

  it('redacts secrets before they leave and counts them', () => {
    // Assembled at runtime so the fixture never reads as a real key to secret scanners.
    const fakeKey = ['sk', 'ant', 'abcdefghijklmnop1234'].join('-');
    const secret = `const API_KEY = "${fakeKey}";\nconst x = 1;`;
    const request = buildEditSelectionRequest({ code: secret, start: secret.indexOf('const x'), end: secret.length, instruction: 'x', language: 'javascript' });
    expect(request.redactedCount).toBe(1);
    expect(request.messages[1]!.content).not.toContain(fakeKey);
    expect(request.messages[1]!.content).toContain(REDACTED_MARK);
  });
});

describe('redaction around the span', () => {
  const fakeKey = ['sk', 'ant', 'abcdefghijklmnop1234'].join('-');
  const content = (code: string, start: number, end: number) =>
    buildEditSelectionRequest({ code, start, end, instruction: 'x', language: 'javascript' });

  it('redacts a secret assignment on the first line of a whole-buffer selection', () => {
    const code = 'const API_KEY = "hunter2-real-secret-value";\nconst x = 1;';
    const request = content(code, 0, code.length);
    expect(request.redactedCount).toBe(1);
    expect(request.messages[1]!.content).not.toContain('hunter2');
    expect(request.messages[1]!.content).toContain('<<<SELECTION>>>const API_KEY = "<redacted>"\nconst x = 1;<<<END SELECTION>>>');
  });

  it('redacts a secret line the selection starts on', () => {
    const code = 'const a = 1;\n  password = "hunter2-real-secret-value";\nconst b = 2;';
    const start = code.indexOf('  password');
    expect(content(code, start, code.length).messages[1]!.content).not.toContain('hunter2');
  });

  it('widens to whole lines when a boundary splits a token, and reports the span it replaces', () => {
    const code = `const a = 1;\nconst k = "${fakeKey}";\nconst b = 2;`;
    const start = code.indexOf('abcdefghij');
    const request = content(code, start, start + 4);
    expect(request.messages[1]!.content).not.toContain('abcdefghij');
    expect(request.span).toMatchObject({ start: code.indexOf('const k'), end: code.indexOf('\nconst b') });
  });

  it('does not pull in the next line when the widened selection ended on a line break', () => {
    const code = `const a = 1;\nconst k = "${fakeKey}";\nconst b = 2;`;
    const end = code.indexOf('const b');
    expect(content(code, code.indexOf('abcdefghij'), end).span).toMatchObject({ start: code.indexOf('const k'), end });
  });

  it('widens to the whole file when a private key spans the selection boundary', () => {
    const armor = (edge: string) => `-----${edge} RSA ${['PRIVATE', 'KEY'].join(' ')}-----`;
    const pem = `${armor('BEGIN')}\nMIIEowIBAAKCAQEA\n${armor('END')}`;
    const code = `const a = 1;\nconst key = \`${pem}\`;\nconst b = 2;`;
    const start = code.indexOf('MIIE');
    const request = content(code, start, code.length);
    expect(request.messages[1]!.content).not.toContain('MIIE');
    expect(request.span).toMatchObject({ start: 0, end: code.length });
  });

  it('keeps the exact span when nothing secret is split', () => {
    const code = 'const a = 1;\nconst b = a + 1;';
    const start = code.indexOf('a + 1');
    expect(content(code, start, start + 5).span).toMatchObject({ start, end: start + 5, before: 'const a = 1;\nconst b = ', selected: 'a + 1' });
  });
});

describe('readEditAnswer', () => {
  it('keeps the line break a selection ended with', () => {
    expect(readEditAnswer('```js\nlet b = 2;\n```', 'let b = 1;\n')).toBe('let b = 2;\n');
    expect(readEditAnswer('```js\nlet b = 2;\n```', 'let b = 1;')).toBe('let b = 2;');
  });

  it('takes the first fenced block', () => {
    expect(readEditAnswer('Sure:\n```js\nlet b = a + 1;\n```\nand ```js\nother\n```')).toBe('let b = a + 1;');
  });

  it('takes the whole answer when there is no fence and strips stray markers', () => {
    expect(readEditAnswer('<<<SELECTION>>>let b = 2;<<<END SELECTION>>>')).toBe('let b = 2;');
  });

  it('keeps inner blank lines and indentation', () => {
    expect(readEditAnswer('```python\n  if x:\n\n    y()\n```')).toBe('  if x:\n\n    y()');
  });
});

describe('applyEdit', () => {
  it('replaces only the selection', () => {
    expect(applyEdit(code, start, end, 'let b = a + 2;')).toBe('const a = 1;\nlet b = a + 2;\nconsole.log(b);\n');
  });
});
