import { describe, expect, it } from 'vitest';

import {
  checkRendererCopy,
  findHardcodedCopyViolations,
} from '../../scripts/check-renderer-copy.mjs';

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

  it('skips touched paths that no longer exist instead of crashing', async () => {
    // Regression — a commit that DELETES a renderer file used to make
    // the guard ENOENT-crash: `git diff-tree HEAD` listed the dead path
    // (it had no deletion-excluding --diff-filter) and the readFile
    // aborted the whole run. First hit: the 2026-06-10 dead-code
    // removal commit. Deleted files cannot ship hardcoded copy.
    const result = await checkRendererCopy([
      'src/renderer/components/__does-not-exist__/Ghost.tsx',
    ]);

    expect(result.files).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});
