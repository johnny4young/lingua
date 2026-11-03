import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SqlQueryTabs } from '../../../src/renderer/components/SqlWorkspace/SqlQueryTabs';
import type { SqlConnectionTone } from '../../../src/renderer/components/SqlWorkspace/sqlConnectionStyle';
import type { SqlQueryV1 } from '../../../src/shared/sqlWorkspace';

const tab = (id: string) => ({ id, name: id, kind: 'saved', query: 'select 1' }) as unknown as SqlQueryV1;

function renderTabs(tone?: SqlConnectionTone) {
  render(
    <SqlQueryTabs
      tabs={[tab('a'), tab('b')]}
      activeId="a"
      runningId={null}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      freeHint={null}
      {...(tone ? { tone } : {})}
    />
  );
  return screen.getAllByTestId('sql-query-tab');
}

describe('SqlQueryTabs', () => {
  it.each([
    ['dev', 'border-t-success-fg'],
    ['staging', 'border-t-warning-fg'],
    ['prod', 'border-t-error-fg'],
  ] as const)('marks only the active tab with the %s colour', (tone, border) => {
    const [active, other] = renderTabs(tone);
    expect(active!.className).toContain(border);
    expect(active!.dataset.env).toBe(tone);
    expect(other!.className).not.toContain('border-t-2');
    expect(other!.dataset.env).toBeUndefined();
  });

  it('draws no environment colour on Local or a connection without an environment', () => {
    expect(renderTabs()[0]!.className).not.toContain('border-t-2');
    expect(renderTabs('none')[0]!.className).not.toContain('border-t-2');
  });
});
