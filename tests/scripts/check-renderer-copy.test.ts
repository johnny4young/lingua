import { describe, expect, it } from 'vitest';

import { findHardcodedCopyViolations } from '../../scripts/check-renderer-copy.mjs';

describe('check-renderer-copy', () => {
  it('flags obvious hardcoded JSX copy', () => {
    const violations = findHardcodedCopyViolations(
      `
        export function Demo() {
          return (
            <section>
              <h1>Workspace Settings</h1>
              <input placeholder="Search files" />
            </section>
          );
        }
      `,
      '/virtual/src/renderer/components/Demo.tsx'
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]?.text).toBe('Workspace Settings');
    expect(violations[1]?.text).toBe('Search files');
  });

  it('ignores translated expressions and code-oriented tags', () => {
    const violations = findHardcodedCopyViolations(
      `
        export function Demo({ t }) {
          return (
            <section>
              <h1>Lingua</h1>
              <h1>{t('settings.title')}</h1>
              <Kbd>Cmd+P</Kbd>
              <code>Hello World</code>
              <button title={t('settings.close')}>{t('settings.close')}</button>
            </section>
          );
        }
      `,
      '/virtual/src/renderer/components/Demo.tsx'
    );

    expect(violations).toEqual([]);
  });
});
