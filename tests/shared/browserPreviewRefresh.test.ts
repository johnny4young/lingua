import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_PREVIEW_REFRESH_INTERVAL,
  extractBrowserPreviewRefreshMagicComment,
  isBrowserPreviewRefreshInterval,
  resolveBrowserPreviewRefreshInterval,
  sanitizeBrowserPreviewRefreshInterval,
} from '../../src/shared/browserPreviewRefresh';

describe('Browser preview refresh contract (RL-119 Slice 1)', () => {
  it('accepts only Off, 300 ms, and 1 second', () => {
    expect(isBrowserPreviewRefreshInterval(0)).toBe(true);
    expect(isBrowserPreviewRefreshInterval(300)).toBe(true);
    expect(isBrowserPreviewRefreshInterval(1_000)).toBe(true);
    expect(isBrowserPreviewRefreshInterval(750)).toBe(false);
    expect(isBrowserPreviewRefreshInterval('300')).toBe(false);
  });

  it('sanitizes storage drift to the 300 ms default', () => {
    expect(DEFAULT_BROWSER_PREVIEW_REFRESH_INTERVAL).toBe(300);
    expect(sanitizeBrowserPreviewRefreshInterval(1_000)).toBe(1_000);
    expect(sanitizeBrowserPreviewRefreshInterval(null)).toBe(300);
    expect(sanitizeBrowserPreviewRefreshInterval(999)).toBe(300);
  });

  it('parses each valid first-line override', () => {
    expect(
      extractBrowserPreviewRefreshMagicComment(
        '// @preview-refresh off\ndocument.body.textContent = "off";'
      )
    ).toBe(0);
    expect(
      extractBrowserPreviewRefreshMagicComment('// @preview-refresh 300\nvoid 0;')
    ).toBe(300);
    expect(
      extractBrowserPreviewRefreshMagicComment(
        '\uFEFF  //   @preview-refresh 1000  \r\nvoid 0;'
      )
    ).toBe(1_000);
  });

  it('ignores directives outside line one or embedded in other text', () => {
    expect(
      extractBrowserPreviewRefreshMagicComment(
        'void 0;\n// @preview-refresh off'
      )
    ).toBeNull();
    expect(
      extractBrowserPreviewRefreshMagicComment(
        'console.log("// @preview-refresh off")'
      )
    ).toBeNull();
    expect(
      extractBrowserPreviewRefreshMagicComment(
        '// @preview-refresh 300 trailing'
      )
    ).toBeNull();
    expect(
      extractBrowserPreviewRefreshMagicComment('// @preview-refresh 750')
    ).toBeNull();
  });

  it('lets a valid tab override win without mutating the preference', () => {
    expect(
      resolveBrowserPreviewRefreshInterval(
        '// @preview-refresh 1000\nvoid 0;',
        300
      )
    ).toBe(1_000);
    expect(resolveBrowserPreviewRefreshInterval('void 0;', 0)).toBe(0);
  });
});
