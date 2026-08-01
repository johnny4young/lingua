import { describe, expect, it } from 'vitest';
import { collectCapsuleWorkspaceCandidates } from '../../../src/renderer/utils/capsuleWorkspaceCandidates';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import type { FileTab } from '../../../src/renderer/types';

function tab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    name: 'helper.ts',
    language: 'typescript',
    content: 'export const answer = 42;',
    isDirty: false,
    ...overrides,
  };
}

describe('collectCapsuleWorkspaceCandidates', () => {
  it('uses capability-relative paths and never absolute filePath values', () => {
    const [candidate] = collectCapsuleWorkspaceCandidates(
      [tab({ relativePath: 'src/helper.ts', filePath: '/Users/private/project/src/helper.ts' })],
      FIXTURE_MINIMAL_JS
    );
    expect(candidate).toMatchObject({ path: 'src/helper.ts', eligible: true });
    expect(JSON.stringify(candidate)).not.toContain('/Users/private');
  });

  it('excludes workspace tabs, duplicate portable paths, and the primary source', () => {
    const candidates = collectCapsuleWorkspaceCandidates(
      [
        tab({ id: 'workspace', kind: 'http', name: 'HTTP' }),
        tab({ id: 'first', relativePath: 'src/Helper.ts' }),
        tab({ id: 'duplicate', relativePath: 'src/helper.ts' }),
        tab({
          id: 'primary',
          name: FIXTURE_MINIMAL_JS.tab.name ?? 'main.js',
          language: 'javascript',
          content: FIXTURE_MINIMAL_JS.source.content,
        }),
      ],
      FIXTURE_MINIMAL_JS
    );
    expect(candidates.map(item => item.exclusionReason)).toEqual([
      'workspace-tab',
      undefined,
      'duplicate-path',
      'primary-source',
    ]);
  });

  it('flags obvious secrets without changing source content', () => {
    const content = 'const token = "ghp_123456789012345678901234567890123456";';
    const [candidate] = collectCapsuleWorkspaceCandidates([tab({ content })], FIXTURE_MINIMAL_JS);
    expect(candidate?.obviousSecretsDetected).toBeGreaterThan(0);
    expect(candidate?.content).toBe(content);
  });
});
