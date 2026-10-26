import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { HttpChainSection } from '@/components/HttpWorkspace/HttpChainSection';
import { HttpEnvironmentPreview } from '@/components/HttpWorkspace/HttpEnvironmentPreview';
import { HttpUrlHint } from '@/components/HttpWorkspace/HttpUrlField';
import { resetWorkspaceToolStoreForTests, useWorkspaceToolStore } from '@/stores/workspaceToolStore';
import { chainTags } from '@/../shared/httpChain';
import { createBlankHttpRequest, type HttpRequestV1, type HttpResponseV1 } from '@/../shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const source: HttpRequestV1 = {
  ...createBlankHttpRequest({ id: 'src', now: NOW }),
  name: 'List repos',
  url: 'https://api.example.com/users/octocat/repos',
  captures: [{ id: 'cap', source: 'body-json', path: '[0].owner.login', targetVariable: 'owner', enabled: true }],
};
const target: HttpRequestV1 = { ...createBlankHttpRequest({ id: 'tgt', now: NOW }), name: 'Get repo', url: 'https://api.example.com/repos/{{owner}}/lingua' };
const recorded = (login: string, status = 200): HttpResponseV1 => ({
  version: 1,
  kind: status < 400 ? 'success' : 'client-error',
  status,
  statusText: '',
  url: source.url,
  finalUrl: source.url,
  headers: [],
  body: JSON.stringify([{ owner: { login } }]),
  contentType: 'application/json',
  sizeBytes: 1,
  durationMs: 211,
  tooLarge: false,
  redactedHeaders: [],
  recordedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
});

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  resetWorkspaceToolStoreForTests();
  useWorkspaceToolStore.setState({ requests: [target, source], responsesByRequestId: { src: [recorded('octocat')] } });
});

const section = (overrides: Partial<React.ComponentProps<typeof HttpChainSection>> = {}) => {
  const tags = chainTags(target, [target, source]);
  return render(
    <HttpChainSection request={target} tags={tags} secretKeys={new Set()} openKey="owner" onClose={vi.fn()} onRun={vi.fn()} {...overrides} />
  );
};

describe('chain tag panel', () => {
  it('shows the source, the path and the live value with its age', () => {
    section();
    expect(screen.getByTestId('http-chain-tag-source').textContent).toBe('List repos · GET https://api.example.com/users/octocat/repos');
    expect(screen.getByTestId('http-chain-tag-path')).toHaveProperty('value', '[0].owner.login');
    expect(screen.getByTestId('http-chain-tag-preview').textContent).toBe('"octocat" · from the response 2 min. ago');
  });

  it('edits the source capture path and the tag rule', async () => {
    section();
    fireEvent.change(screen.getByTestId('http-chain-tag-path'), { target: { value: '[0].name' } });
    expect(useWorkspaceToolStore.getState().getRequest('src')?.captures?.[0]?.path).toBe('[0].name');
    await userEvent.click(screen.getByRole('radio', { name: 'Send source first' }));
    expect(useWorkspaceToolStore.getState().getRequest('tgt')?.chainRules).toEqual({ owner: 'source-first' });
  });

  it('says when another request also captures the variable', () => {
    const refresh = { ...createBlankHttpRequest({ id: 'refresh', now: NOW }), name: 'Refresh', url: 'https://x', captures: [{ id: 'c9', source: 'body-json' as const, path: 'login', targetVariable: 'owner', enabled: true }] };
    useWorkspaceToolStore.setState({ requests: [target, source, refresh] });
    section();
    expect(screen.getByTestId('http-chain-tag-others').textContent).toBe('Also captured by Refresh; the tag reads the first one in the list.');
  });

  it('masks a secret value and says when there is no 2xx response', () => {
    const { unmount } = section({ secretKeys: new Set(['owner']) });
    expect(screen.getByTestId('http-chain-tag-preview').textContent).toContain('••••••');
    expect(screen.getByTestId('http-chain-tag-preview').textContent).not.toContain('octocat');
    unmount();
    useWorkspaceToolStore.setState({ responsesByRequestId: { src: [recorded('x', 404)] } });
    section();
    expect(screen.getByTestId('http-chain-tag-preview').textContent).toBe('No value: the latest response is missing or not 2xx');
  });
});

describe('derived chain view', () => {
  it('lists each source with its last status before the request, and runs the chain', async () => {
    const onRun = vi.fn();
    section({ openKey: null, onRun });
    const nodes = screen.getAllByTestId('http-chain-node');
    expect(nodes.map((node) => node.textContent)).toEqual(['200List repos211 ms', '→—Get repowaits']);
    await userEvent.click(screen.getByTestId('http-chain-run'));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('opens a tag from its chip under the URL', async () => {
    const onOpenTag = vi.fn();
    render(<HttpEnvironmentPreview request={target} env={null} chainKeys={new Set(['owner'])} openTag={null} onOpenTag={onOpenTag} />);
    const chip = screen.getByTestId('http-chain-chip');
    expect(chip.getAttribute('aria-label')).toBe('Open chain tag owner');
    await userEvent.click(chip);
    expect(onOpenTag).toHaveBeenCalledWith('owner');
  });

  it('says which source to send when a tag has no value yet', () => {
    render(<HttpUrlHint state={{ ok: false, reason: 'unresolved', key: 'owner' }} transport="http" hasEnvironment={false} chainSource="List repos" />);
    expect(screen.getByTestId('http-request-editor-url-hint').textContent).toBe(
      'owner comes from List repos, which has no 2xx response yet: send it, or set the tag to Send source first.'
    );
  });
});
