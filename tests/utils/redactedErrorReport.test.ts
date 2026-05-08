import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildErrorReport,
  copyErrorReportToClipboard,
  redactStack,
} from '@/utils/redactedErrorReport';

describe('redactStack', () => {
  it('strips macOS absolute paths', () => {
    const stack = [
      'TypeError: boom',
      '    at Component (/Users/johnny4young/Personal/github/lingua/src/renderer/components/Foo.tsx:42:13)',
      '    at App (/Users/johnny4young/Personal/github/lingua/src/renderer/App.tsx:128:5)',
    ].join('\n');
    const redacted = redactStack(stack);
    expect(redacted).not.toMatch(/\/Users\/johnny4young/u);
    expect(redacted).toMatch(/<asset>/u);
  });

  it('strips Windows drive-letter paths', () => {
    const stack = [
      'Error: nope',
      '    at Foo (C:\\Users\\johnny\\Documents\\repo\\src\\renderer\\Foo.tsx:1:1)',
    ].join('\n');
    const redacted = redactStack(stack);
    expect(redacted).not.toMatch(/C:\\Users\\johnny/u);
    expect(redacted).toMatch(/<asset>/u);
  });

  it('strips file:// URLs', () => {
    const stack = [
      'Error: oh no',
      '    at chunk (file:///Applications/Lingua.app/Contents/Resources/dist/web/assets/index.js:99:5)',
    ].join('\n');
    const redacted = redactStack(stack);
    expect(redacted).not.toMatch(/file:\/\//u);
    expect(redacted).toMatch(/<asset>/u);
  });

  it('caps at 20 frames', () => {
    const stack = ['Error: deep'].concat(
      Array.from({ length: 50 }, (_, i) => `    at frame${i} (a.js:${i}:${i})`)
    );
    const redacted = redactStack(stack.join('\n'));
    expect(redacted.split('\n')).toHaveLength(20);
  });

  it('keeps asset:line:col coordinates intact', () => {
    const stack = '    at run (assets/main-XYZ.js:42:7)';
    const redacted = redactStack(stack);
    expect(redacted).toMatch(/main-XYZ\.js:42:7/u);
  });
});

describe('buildErrorReport', () => {
  it('produces the deterministic shape with the redacted stack', () => {
    const error = new Error('something broke');
    error.stack =
      'Error: something broke\n    at Foo (/Users/jane/proj/src/Foo.tsx:1:1)';
    const report = buildErrorReport(error, 'editor', new Date('2026-05-07T14:30:00Z'));
    expect(report.timestamp).toBe('2026-05-07T14:30:00.000Z');
    expect(report.region).toBe('editor');
    expect(report.errorName).toBe('Error');
    expect(report.errorMessage).toBe('something broke');
    expect(report.redactedStack).toMatch(/<asset>/u);
    expect(report.redactedStack).not.toMatch(/\/Users\/jane/u);
    expect(typeof report.appVersion).toBe('string');
  });

  it('coerces non-Error throws into an Error envelope', () => {
    const report = buildErrorReport('a thrown string', 'editor');
    expect(report.errorName).toBe('Error');
    expect(report.errorMessage).toBe('a thrown string');
  });

  it('truncates extremely long messages to 500 chars', () => {
    const huge = new Error('X'.repeat(2_000));
    const report = buildErrorReport(huge, 'editor');
    expect(report.errorMessage.length).toBe(500);
  });
});

describe('copyErrorReportToClipboard', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  let writeTextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    writeTextSpy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
    const report = buildErrorReport(new Error('boom'), 'editor');
    await expect(copyErrorReportToClipboard(report)).resolves.toBe(true);
    expect(writeTextSpy).toHaveBeenCalledOnce();
  });

  it('falls back to execCommand when navigator.clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: execCommandSpy,
    });
    const report = buildErrorReport(new Error('boom'), 'editor');
    await expect(copyErrorReportToClipboard(report)).resolves.toBe(true);
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when writeText throws', async () => {
    writeTextSpy = vi.fn(async () => {
      throw new Error('permission denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: execCommandSpy,
    });
    const report = buildErrorReport(new Error('boom'), 'editor');
    await expect(copyErrorReportToClipboard(report)).resolves.toBe(true);
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
  });

  it('removes the fallback textarea when execCommand throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new Error('copy blocked');
      }),
    });
    const report = buildErrorReport(new Error('boom'), 'editor');
    await expect(copyErrorReportToClipboard(report)).resolves.toBe(false);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
