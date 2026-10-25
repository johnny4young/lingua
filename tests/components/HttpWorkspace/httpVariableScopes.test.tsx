import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { HttpEnvironmentManager } from '@/components/HttpWorkspace/HttpEnvironmentManager';
import { HttpEnvironmentPreview } from '@/components/HttpWorkspace/HttpEnvironmentPreview';
import { HttpRequestBuilderTabs } from '@/components/HttpWorkspace/HttpRequestBuilderTabs';
import { HttpSendButton } from '@/components/HttpWorkspace/HttpSendButton';
import { HttpUrlField } from '@/components/HttpWorkspace/HttpUrlField';
import { ENVIRONMENT_TINTS, SCOPE_TINTS, UNRESOLVED_TINT } from '@/components/HttpWorkspace/httpScopeColors';
import { rowsFromOtherEnvironments, scopedEnvironmentFor } from '@/components/HttpWorkspace/httpScopes';
import { useSettingsStore } from '@/stores/settingsStore';
import { resetWorkspaceToolStoreForTests, useWorkspaceToolStore } from '@/stores/workspaceToolStore';
import {
  createBlankHttpEnvironment,
  layeredEnvironment,
  variableSources,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
  type HttpVariableLayers,
} from '@/../shared/httpEnvironment';
import { createBlankHttpRequest } from '@/../shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const v = (id: string, key: string, value: string, secret = false): HttpEnvVariableV1 => ({ id, key, value, secret });
const env = (id: string, name: string, variables: HttpEnvVariableV1[] = []): HttpEnvironmentV1 => ({
  ...createBlankHttpEnvironment({ id, name, now: NOW }),
  variables,
});
const layers: HttpVariableLayers = {
  collection: [v('c1', 'base', 'https://collection.example'), v('c2', 'owner', 'octocat'), v('c3', 'token', 'coll-secret', true)],
  environment: env('e1', 'staging', [v('e1', 'base', 'https://staging.example')]),
  request: [v('r1', 'repo', 'lingua')],
};

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  resetWorkspaceToolStoreForTests();
  useSettingsStore.setState({ featureFlags: { httpScopes: true } });
});

describe('scope colours in the URL', () => {
  const field = (sources?: ReturnType<typeof variableSources>) =>
    render(
      <HttpUrlField
        value="{{base}}/{{owner}}/{{repo}}/{{missing}}"
        env={layeredEnvironment(layers)}
        {...(sources ? { sources } : {})}
        placeholder=""
        ariaLabel="URL"
        onChange={vi.fn()}
        onPaste={vi.fn()}
      />
    );

  it('colours each token by the scope that resolves it, red when none does', () => {
    field(variableSources(layers));
    const tokens = screen.getAllByTestId('http-request-editor-url-token');
    expect(tokens.map((token) => token.dataset.state)).toEqual(['environment', 'collection', 'request', 'missing']);
    expect(tokens[0]!.style.color).toBe(SCOPE_TINTS.environment.fg);
    expect(tokens[1]!.style.color).toBe(SCOPE_TINTS.collection.fg);
    expect(tokens[2]!.style.color).toBe(SCOPE_TINTS.request.fg);
    expect(tokens[3]!.style.color).toBe(UNRESOLVED_TINT.fg);
  });

  it('keeps the defined and missing look without scopes', () => {
    field();
    const tokens = screen.getAllByTestId('http-request-editor-url-token');
    expect(tokens.map((token) => token.dataset.state)).toEqual(['defined', 'defined', 'defined', 'missing']);
    expect(tokens[0]!.getAttribute('style')).toBeNull();
  });
});

describe('preview chips', () => {
  it('say where each value comes from and never print a secret', () => {
    const request = { ...createBlankHttpRequest({ id: 'r', now: NOW }), url: '{{base}}/{{owner}}/{{token}}' };
    render(<HttpEnvironmentPreview request={request} env={layeredEnvironment(layers)} sources={variableSources(layers)} />);
    const base = screen.getAllByTestId('http-environment-preview-chip').find((chip) => chip.textContent?.startsWith('base'))!;
    expect(base.dataset.scope).toBe('environment');
    expect(base.title).toBe('Scope: environment · overrides collection');
    const secret = screen.getByTestId('http-environment-preview-chip-secret');
    expect(secret.dataset.scope).toBe('collection');
    expect(screen.getByTestId('http-environment-preview').textContent).not.toContain('coll-secret');
  });
});

describe('preview strip', () => {
  it('stays hidden for a plain URL when only the collection has variables', () => {
    const scoped = layeredEnvironment({ collection: [v('c', 'owner', 'octocat')], environment: null, request: [] });
    const request = { ...createBlankHttpRequest({ id: 'r', now: NOW }), url: 'https://example.com' };
    render(<HttpEnvironmentPreview request={request} env={scoped} sources={variableSources({ collection: [], environment: null, request: [] })} />);
    expect(screen.queryByTestId('http-environment-preview')).toBeNull();
  });
});

describe('environment manager with scopes', () => {
  const props = (overrides: Partial<React.ComponentProps<typeof HttpEnvironmentManager>> = {}) => ({
    environments: [env('e1', 'prod', [v('p1', 'base', 'https://api.example.com')])],
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateVariables: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(() => '{}'),
    onImport: vi.fn(() => ({ ok: true as const, id: 'x' })),
    ...overrides,
  });

  it('edits the collection from its own tab', async () => {
    const onUpdateCollection = vi.fn();
    render(<HttpEnvironmentManager {...props({ scopes: { collectionVariables: [v('c1', 'owner', 'octocat')], onUpdateCollection } })} />);
    await userEvent.click(screen.getByTestId('http-environment-collection-tab'));
    const section = screen.getByTestId('http-environment-collection');
    expect(within(section).getByTestId('http-environment-var-key')).toHaveProperty('value', 'owner');
    fireEvent.change(within(section).getByTestId('http-environment-var-value'), { target: { value: 'hubot' } });
    const updater = onUpdateCollection.mock.calls[0]![0] as (rows: HttpEnvVariableV1[]) => HttpEnvVariableV1[];
    expect(updater([v('c1', 'owner', 'octocat')])).toEqual([v('c1', 'owner', 'hubot')]);
  });

  it('opens on the collection when there are no environments', () => {
    render(<HttpEnvironmentManager {...props({ environments: [], scopes: { collectionVariables: [], onUpdateCollection: vi.fn() } })} />);
    expect(screen.getByTestId('http-environment-collection')).toBeTruthy();
    expect(screen.queryByTestId('http-environment-empty')).toBeNull();
  });

  it('picks a colour per environment and shows a prod name as red', async () => {
    const onUpdate = vi.fn();
    render(<HttpEnvironmentManager {...props({ onUpdate, scopes: { collectionVariables: [], onUpdateCollection: vi.fn() } })} />);
    const picker = screen.getByTestId('http-environment-color');
    await userEvent.click(within(picker).getByRole('radio', { name: 'Blue' }));
    expect(onUpdate).toHaveBeenCalledWith('e1', { color: 'blue' });
    expect(within(picker).getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(within(picker).getByRole('radio', { name: 'No color' }));
    expect(onUpdate).toHaveBeenLastCalledWith('e1', { color: 'none' });
    const tab = screen.getByRole('tab', { name: 'prod' });
    expect((tab.querySelector('span') as HTMLElement).style.backgroundColor).toBe(ENVIRONMENT_TINTS.red.line);
  });

  it('opens on the row to fill in with its value field focused', async () => {
    render(
      <HttpEnvironmentManager
        {...props({
          environments: [env('e1', 'prod', [v('p1', 'base', 'x')]), env('e2', 'staging', [v('s1', 'token', '', true)])],
          focus: { environmentId: 'e2', variableId: 's1' },
          scopes: { collectionVariables: [], onUpdateCollection: vi.fn() },
        })}
      />
    );
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('http-environment-var-value'));
    expect(document.activeElement?.getAttribute('type')).toBe('password');
    expect(screen.getByRole('tab', { name: 'staging' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows neither the collection nor colours without scopes', () => {
    render(<HttpEnvironmentManager {...props()} />);
    expect(screen.queryByTestId('http-environment-collection-tab')).toBeNull();
    expect(screen.queryByTestId('http-environment-color')).toBeNull();
  });
});

describe('request Vars tab and tint', () => {
  const tabProps = {
    method: 'GET' as const,
    activeTab: 'vars' as const,
    onSelectTab: vi.fn(),
    params: [],
    onAddParam: vi.fn(),
    onUpdateParam: vi.fn(),
    onRemoveParam: vi.fn(),
    auth: undefined,
    onAuthChange: vi.fn(),
    headers: [],
    onAddHeader: vi.fn(),
    onUpdateHeader: vi.fn(),
    onRemoveHeader: vi.fn(),
    body: undefined,
    onBodyKindChange: vi.fn(),
    onBodyContentChange: vi.fn(),
    captures: [],
    onAddCapture: vi.fn(),
    onUpdateCapture: vi.fn(),
    onRemoveCapture: vi.fn(),
    assertions: [],
    onAddAssertion: vi.fn(),
    onUpdateAssertion: vi.fn(),
    onRemoveAssertion: vi.fn(),
  };

  it('edits the request own variables through its callback', async () => {
    const onUpdate = vi.fn();
    render(<HttpRequestBuilderTabs {...tabProps} variables={{ rows: [], onUpdate }} tint={ENVIRONMENT_TINTS.red} />);
    expect(screen.getByTestId('http-request-editor-tabs').style.borderBottomColor).toBe(ENVIRONMENT_TINTS.red.line);
    await userEvent.click(within(screen.getByTestId('http-request-editor-vars')).getByTestId('http-environment-var-add'));
    const updater = onUpdate.mock.calls[0]![0] as (rows: HttpEnvVariableV1[]) => HttpEnvVariableV1[];
    expect(updater([])).toHaveLength(1);
  });

  it('falls back to Params when the Vars tab is gone', () => {
    render(<HttpRequestBuilderTabs {...tabProps} />);
    expect(screen.queryByTestId('http-request-editor-tab-vars')).toBeNull();
    expect(screen.getByTestId('http-request-editor-tab-params').dataset.active).toBe('true');
  });

  it('tints Send with the environment colour', () => {
    render(<HttpSendButton isExecuting={false} disabled={false} combo="⌘↵" onSend={vi.fn()} tint={ENVIRONMENT_TINTS.red} />);
    const send = screen.getByTestId('http-request-editor-send');
    expect(send.dataset.tinted).toBe('true');
    expect(send.className).toContain('hover:brightness-110');
    expect(send.style.backgroundColor).toContain('var(--color-error-border)');
  });
});

describe('scope helpers', () => {
  it('copies the first definition from another environment, and a secret as its key only', () => {
    const environments = [
      env('prod', 'prod'),
      env('stg', 'staging', [v('s1', 'pageSize', '50'), v('s2', 'token', 'x', true)]),
      env('dev', 'dev', [v('d1', 'pageSize', '10'), v('d2', 'blank', '')]),
    ];
    const rows = rowsFromOtherEnvironments(['pageSize', 'token', 'nowhere', 'blank'], environments, 'prod');
    expect(rows.map(({ key, value, secret }) => ({ key, value, secret }))).toEqual([
      { key: 'pageSize', value: '50', secret: false },
      { key: 'token', value: '', secret: true },
    ]);
    expect(rows[0]!.id).not.toBe('s1');
  });

  it('layers collection and request variables only with the flag on', () => {
    useWorkspaceToolStore.setState({ collectionVariables: [v('c', 'owner', 'octocat')] });
    const request = { variables: [v('r', 'repo', 'lingua')] };
    expect(scopedEnvironmentFor(request, null)?.variables.map((row) => row.key)).toEqual(['owner', 'repo']);
    useSettingsStore.setState({ featureFlags: {} });
    expect(scopedEnvironmentFor(request, null)).toBeNull();
  });
});
