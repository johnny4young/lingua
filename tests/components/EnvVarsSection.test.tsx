/**
 * implementation — Settings panel covers the global env-var tier.
 *
 * The implementation store already has full unit coverage; these component tests
 * pin the rendered affordances (empty state, add form, list + remove,
 * validator error path, precedence hint, and the Spanish locale).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EnvVarsSection } from '@/components/Settings/EnvVarsSection';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';

describe('EnvVarsSection', () => {
  const initialEnv = useEnvVarsStore.getState();
  const initialEditor = useEditorStore.getState();
  const initialProject = useProjectStore.getState();

  beforeEach(async () => {
    useEnvVarsStore.setState(initialEnv, true);
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('lingua-env-vars');
    }
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useEnvVarsStore.setState(initialEnv, true);
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
  });

  function seedActiveTab(tabId: string): void {
    useEditorStore.setState({
      tabs: [
        {
          id: tabId,
          name: `${tabId}.ts`,
          language: 'typescript',
          content: '',
          isDirty: false,
        },
      ],
      activeTabId: tabId,
    });
  }

  function seedActiveProject(id: string, name: string = id): void {
    useProjectStore.setState({
      currentProject: {
        id,
        name,
        rootPath: `/tmp/${id}`,
        openedAt: Date.now(),
      },
    });
  }

  it('renders the empty state when no global env vars exist', () => {
    render(<EnvVarsSection />);
    expect(screen.getByText('Global scope')).toBeTruthy();
    expect(screen.getByTestId('env-vars-empty')).toBeTruthy();
    expect(screen.queryByTestId('env-vars-list')).toBeNull();
    // Precedence hint is always visible so the user knows this is only
    // one of the three tiers.
    expect(screen.getByTestId('env-vars-precedence-note')).toBeTruthy();
  });

  it('adds a valid global env var and clears the draft inputs', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-key-input'), 'FOO');
    await user.type(screen.getByTestId('env-vars-value-input'), 'bar');
    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(useEnvVarsStore.getState().global.FOO).toBe('bar');
    const list = screen.getByTestId('env-vars-list');
    expect(within(list).getByText('FOO')).toBeTruthy();
    expect(within(list).getByText('bar')).toBeTruthy();
    // Drafts reset after a successful add so the next entry starts clean.
    expect((screen.getByTestId('env-vars-key-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('env-vars-value-input') as HTMLInputElement).value).toBe('');
  });

  it('surfaces a localized error when the key is blank', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(screen.getByTestId('env-vars-error').textContent).toContain(
      'Enter a key before adding.'
    );
    expect(useEnvVarsStore.getState().global).toEqual({});
  });

  it('rejects a reserved host variable and surfaces the validator error', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-key-input'), 'PATH');
    await user.type(screen.getByTestId('env-vars-value-input'), 'hostile');
    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(screen.getByTestId('env-vars-error').textContent).toMatch(/POSIX/);
    expect(useEnvVarsStore.getState().global).toEqual({});
  });

  it('renders the empty-string sentinel when the value is empty', async () => {
    useEnvVarsStore.setState({ global: { MASKED: '' } });
    render(<EnvVarsSection />);
    // The sentinel renders inside the global scope row. The effective-env
    // panel also renders it for the same key, so assert >= 1 match rather
    // than a unique one.
    expect(screen.getAllByText('(empty string)').length).toBeGreaterThan(0);
  });

  it('removes a global env var through the row button', async () => {
    const user = userEvent.setup();
    useEnvVarsStore.setState({ global: { FOO: 'bar' } });
    render(<EnvVarsSection />);

    await user.click(screen.getByTestId('env-vars-remove-FOO'));
    expect(useEnvVarsStore.getState().global).toEqual({});
    expect(screen.getByTestId('env-vars-empty')).toBeTruthy();
  });

  it('localizes every visible string in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<EnvVarsSection />);

    expect(screen.getByText('Variables de entorno')).toBeTruthy();
    expect(screen.getByText('Ámbito global')).toBeTruthy();
    expect(screen.getByText('Aún no hay variables de entorno globales.')).toBeTruthy();
    expect(screen.getByTestId('env-vars-add-button').textContent).toContain('Añadir');
  });

  // ----------------------------------------------------------------
  // implementation second increment — tab-tier editor
  // ----------------------------------------------------------------

  it('shows the tab-scope no-active placeholder when there is no active tab', () => {
    render(<EnvVarsSection />);
    expect(screen.getByTestId('env-vars-tab-no-active')).toBeTruthy();
    expect(screen.queryByTestId('env-vars-tab-form')).toBeNull();
  });

  it('renders the tab-scope editor with an empty state when a tab is active but has no vars', () => {
    seedActiveTab('tab-1');
    render(<EnvVarsSection />);
    expect(screen.queryByTestId('env-vars-tab-no-active')).toBeNull();
    expect(screen.getByTestId('env-vars-tab-form')).toBeTruthy();
    expect(screen.getByTestId('env-vars-tab-empty')).toBeTruthy();
  });

  it('adds a tab-scoped env var and keys it under the active tabId in the store', async () => {
    const user = userEvent.setup();
    seedActiveTab('tab-42');
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-tab-key-input'), 'API_URL');
    await user.type(
      screen.getByTestId('env-vars-tab-value-input'),
      'https://example.invalid'
    );
    await user.click(screen.getByTestId('env-vars-tab-add-button'));

    expect(useEnvVarsStore.getState().tab['tab-42']?.API_URL).toBe(
      'https://example.invalid'
    );
    expect(
      within(screen.getByTestId('env-vars-tab-list')).getByText('API_URL')
    ).toBeTruthy();
  });

  it('removes a tab-scoped env var through the row button and prunes the tab entry when it becomes empty', async () => {
    const user = userEvent.setup();
    seedActiveTab('tab-1');
    useEnvVarsStore.setState({ tab: { 'tab-1': { API_URL: 'x' } } });
    render(<EnvVarsSection />);

    await user.click(screen.getByTestId('env-vars-tab-remove-API_URL'));

    expect('tab-1' in useEnvVarsStore.getState().tab).toBe(false);
    expect(screen.getByTestId('env-vars-tab-empty')).toBeTruthy();
  });

  it('surfaces the validator error on the tab-scope editor for reserved keys', async () => {
    const user = userEvent.setup();
    seedActiveTab('tab-1');
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-tab-key-input'), 'HOME');
    await user.type(screen.getByTestId('env-vars-tab-value-input'), '/nope');
    await user.click(screen.getByTestId('env-vars-tab-add-button'));

    expect(screen.getByTestId('env-vars-tab-error').textContent).toMatch(/POSIX/);
    expect(useEnvVarsStore.getState().tab).toEqual({});
  });

  it('localizes the tab-scope copy in Spanish', async () => {
    await i18next.changeLanguage('es');
    seedActiveTab('tab-es');
    render(<EnvVarsSection />);

    expect(screen.getByText('Ámbito de la pestaña activa')).toBeTruthy();
    expect(
      screen.getByText('Aún no hay variables específicas de esta pestaña.')
    ).toBeTruthy();
  });

  it('uses the no-active-tab copy in Spanish too', async () => {
    await i18next.changeLanguage('es');
    render(<EnvVarsSection />);
    expect(
      screen.getByText('Abre una pestaña para definir variables con alcance de pestaña.')
    ).toBeTruthy();
  });

  // ----------------------------------------------------------------
  // implementation third increment — project tier + effective-env trace view
  // ----------------------------------------------------------------

  it('shows the project-scope no-active placeholder when there is no current project', () => {
    render(<EnvVarsSection />);
    expect(screen.getByTestId('env-vars-project-no-active')).toBeTruthy();
    expect(screen.queryByTestId('env-vars-project-form')).toBeNull();
  });

  it('renders the project-scope editor and writes keys under the project id', async () => {
    const user = userEvent.setup();
    seedActiveProject('proj-42', 'Lingua Core');
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-project-key-input'), 'DB_URL');
    await user.type(
      screen.getByTestId('env-vars-project-value-input'),
      'postgres://localhost'
    );
    await user.click(screen.getByTestId('env-vars-project-add-button'));

    expect(useEnvVarsStore.getState().project['proj-42']?.DB_URL).toBe(
      'postgres://localhost'
    );
    // Description interpolates the project name for trust.
    expect(screen.getByText(/Lingua Core/)).toBeTruthy();
  });

  it('exposes the effective-env trace with the tier that won for every key', async () => {
    const user = userEvent.setup();
    seedActiveTab('tab-1');
    seedActiveProject('proj-1');
    useEnvVarsStore.setState({
      global: { SHARED: 'from-global', GLOBAL_ONLY: 'g' },
      project: { 'proj-1': { SHARED: 'from-project', PROJECT_ONLY: 'p' } },
      tab: { 'tab-1': { SHARED: 'from-tab', TAB_ONLY: 't' } },
    });
    render(<EnvVarsSection />);

    const summary = screen
      .getByTestId('env-vars-effective')
      .querySelector('summary');
    expect(summary).toBeTruthy();
    await user.click(summary as HTMLElement);

    // SHARED is overridden by tab, GLOBAL_ONLY wins from global, etc.
    expect(
      screen.getByTestId('env-vars-effective-tier-SHARED').textContent?.trim()
    ).toBe('tab');
    expect(
      screen.getByTestId('env-vars-effective-tier-GLOBAL_ONLY').textContent?.trim()
    ).toBe('global');
    expect(
      screen.getByTestId('env-vars-effective-tier-PROJECT_ONLY').textContent?.trim()
    ).toBe('project');
    expect(
      screen.getByTestId('env-vars-effective-tier-TAB_ONLY').textContent?.trim()
    ).toBe('tab');
  });

  it('shows the effective-env empty hint when every tier is empty', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    const summary =
      screen
        .getByTestId('env-vars-effective')
        .querySelector('summary');
    expect(summary).toBeTruthy();
    await user.click(summary as HTMLElement);

    expect(screen.getByTestId('env-vars-effective-empty')).toBeTruthy();
    expect(screen.queryByTestId('env-vars-effective-list')).toBeNull();
  });

  it('localizes the project-scope + trace copy in Spanish', async () => {
    await i18next.changeLanguage('es');
    seedActiveProject('proj-es', 'Proyecto Prueba');
    useEnvVarsStore.setState({
      global: { FOO: 'g' },
      project: { 'proj-es': { FOO: 'p' } },
    });
    render(<EnvVarsSection />);

    expect(screen.getByText('Ámbito del proyecto')).toBeTruthy();
    expect(screen.getByText(/Proyecto Prueba/)).toBeTruthy();

    const summary = screen
      .getByTestId('env-vars-effective')
      .querySelector('summary');
    expect(summary?.textContent).toContain('Entorno efectivo (vista previa)');
    const user = userEvent.setup();
    await user.click(summary as HTMLElement);
    expect(
      screen.getByTestId('env-vars-effective-tier-FOO').textContent?.trim()
    ).toBe('proyecto');
  });
});
