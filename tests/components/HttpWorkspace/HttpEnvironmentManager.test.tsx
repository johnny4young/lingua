/**
 * RL-097 Slice 3a — HttpEnvironmentManager.
 *
 * Pins: empty state; add environment; add / edit / delete variable;
 * secret toggle flips the value input to a masked password field; delete
 * environment; a11y (role=dialog, real <button>s, Escape closes); and
 * the ES tuteo locale (Agrega / Gestiona / Elimina forms, never voseo).
 *
 * Matchers follow the repo convention (`.getAttribute` / `.textContent`
 * / `.toBeTruthy`) — this codebase does NOT load `@testing-library/jest-dom`.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { HttpEnvironmentManager } from '@/components/HttpWorkspace/HttpEnvironmentManager';
import {
  createBlankHttpEnvironment,
  type HttpEnvironmentV1,
} from '@/../shared/httpEnvironment';

function env(
  id: string,
  name: string,
  variables: HttpEnvironmentV1['variables'] = []
): HttpEnvironmentV1 {
  return {
    ...createBlankHttpEnvironment({ id, name, now: '2026-06-16T00:00:00.000Z' }),
    variables,
  };
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18next.changeLanguage('en');
});

describe('HttpEnvironmentManager', () => {
  it('renders the empty state when there are no environments', () => {
    render(
      <HttpEnvironmentManager
        environments={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByTestId('http-environment-empty').textContent).toContain(
      'No environments yet'
    );
  });

  it('is a dialog with a labelled title and a real close button', async () => {
    const onClose = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev')]}
        onClose={onClose}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.tagName).toBe('BUTTON');
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the modal', () => {
    const onClose = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev')]}
        onClose={onClose}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Add environment fires onCreate with a fresh env', async () => {
    const onCreate = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-add'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const created = onCreate.mock.calls[0]?.[0] as HttpEnvironmentV1;
    expect(created.version).toBe(1);
    expect(created.variables).toEqual([]);
  });

  it('Add variable appends a blank row via onUpdate', async () => {
    const onUpdate = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev')]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-var-add'));
    expect(onUpdate).toHaveBeenCalledWith('e1', {
      variables: [{ key: '', value: '', secret: false }],
    });
  });

  it('editing a variable key fires onUpdate with the patched key', async () => {
    const onUpdate = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev', [{ key: '', value: '', secret: false }])]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );
    await userEvent.type(screen.getByTestId('http-environment-var-key'), 'H');
    expect(onUpdate).toHaveBeenLastCalledWith('e1', {
      variables: [{ key: 'H', value: '', secret: false }],
    });
  });

  it('the secret toggle renders the value input as a masked password field', async () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <HttpEnvironmentManager
        environments={[
          env('e1', 'Dev', [{ key: 'token', value: 'sk', secret: false }]),
        ]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );
    // Initially a visible text input.
    expect(
      screen.getByTestId('http-environment-var-value').getAttribute('type')
    ).toBe('text');
    await userEvent.click(screen.getByTestId('http-environment-var-secret'));
    expect(onUpdate).toHaveBeenLastCalledWith('e1', {
      variables: [{ key: 'token', value: 'sk', secret: true }],
    });
    // After the store flips secret, the value input masks.
    rerender(
      <HttpEnvironmentManager
        environments={[
          env('e1', 'Dev', [{ key: 'token', value: 'sk', secret: true }]),
        ]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.getByTestId('http-environment-var-value').getAttribute('type')
    ).toBe('password');
  });

  it('delete variable fires onUpdate without the removed row', async () => {
    const onUpdate = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[
          env('e1', 'Dev', [
            { key: 'a', value: '1', secret: false },
            { key: 'b', value: '2', secret: false },
          ]),
        ]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('http-environment-var-delete');
    await userEvent.click(rows[0]!);
    expect(onUpdate).toHaveBeenCalledWith('e1', {
      variables: [{ key: 'b', value: '2', secret: false }],
    });
  });

  it('delete environment fires onDelete with the env id', async () => {
    const onDelete = vi.fn();
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev')]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-delete'));
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('renders the ES tuteo locale (Gestiona / Agrega, never voseo)', async () => {
    await i18next.changeLanguage('es');
    render(
      <HttpEnvironmentManager
        environments={[env('e1', 'Dev')]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.getByTestId('http-environment-manager').textContent
    ).toContain('Entornos HTTP');
    expect(screen.getByTestId('http-environment-add').textContent).toContain(
      'Agrega entorno'
    );
    // Voseo guard — none of these forms may appear in the rendered copy.
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('Agregá');
    expect(body).not.toContain('Gestioná');
    expect(body).not.toContain('Eliminá');
  });
});
