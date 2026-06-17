/**
 * RL-097 Slices 3a + 3b — HttpEnvironmentManager.
 *
 * Pins (3a): empty state; add environment; add / edit / delete variable;
 * secret toggle flips the value input to a masked password field; delete
 * environment; a11y (role=dialog, real <button>s, Escape closes); ES tuteo.
 *
 * Pins (3b): functional variable updates (collapse-safe via the
 * `onUpdateVariables` updater), secret-by-default heuristic on key edit
 * (match / no-match / no-override), duplicate-environment, export-to-
 * clipboard, import (textarea → parse → append), drag-reorder handler
 * (arrayMove via the updater), and stable `variable.id` React keys.
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
  type HttpEnvVariableV1,
} from '@/../shared/httpEnvironment';

function env(
  id: string,
  name: string,
  variables: HttpEnvVariableV1[] = []
): HttpEnvironmentV1 {
  return {
    ...createBlankHttpEnvironment({ id, name, now: '2026-06-16T00:00:00.000Z' }),
    variables,
  };
}

/** Build a variable row with an explicit id (Slice 3b). */
function v(
  id: string,
  key: string,
  value: string,
  secret = false
): HttpEnvVariableV1 {
  return { id, key, value, secret };
}

/**
 * Default no-op props so each test only wires the callbacks it asserts on.
 */
function props(overrides: Partial<React.ComponentProps<typeof HttpEnvironmentManager>> = {}) {
  return {
    environments: [] as HttpEnvironmentV1[],
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateVariables: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(() => '{}'),
    onImport: vi.fn(() => ({ ok: true as const, id: 'imported' })),
    ...overrides,
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
    render(<HttpEnvironmentManager {...props()} />);
    expect(screen.getByTestId('http-environment-empty').textContent).toContain(
      'No environments yet'
    );
  });

  it('is a dialog with a labelled title and a real close button', async () => {
    const onClose = vi.fn();
    render(
      <HttpEnvironmentManager {...props({ environments: [env('e1', 'Dev')], onClose })} />
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
      <HttpEnvironmentManager {...props({ environments: [env('e1', 'Dev')], onClose })} />
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Add environment fires onCreate with a fresh env', async () => {
    const onCreate = vi.fn();
    render(<HttpEnvironmentManager {...props({ onCreate })} />);
    await userEvent.click(screen.getByTestId('http-environment-add'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const created = onCreate.mock.calls[0]?.[0] as HttpEnvironmentV1;
    expect(created.version).toBe(1);
    expect(created.variables).toEqual([]);
  });

  it('Add variable appends a freshly-id`d blank row via the functional updater', async () => {
    const onUpdateVariables = vi.fn();
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onUpdateVariables })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-var-add'));
    expect(onUpdateVariables).toHaveBeenCalledTimes(1);
    const [id, updater] = onUpdateVariables.mock.calls[0]!;
    expect(id).toBe('e1');
    // Apply the updater to an empty list → one blank row with a real id.
    const next = updater([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ key: '', value: '', secret: false });
    expect(typeof next[0].id).toBe('string');
    expect(next[0].id.length).toBeGreaterThan(0);
  });

  it('two Add-variable clicks COMPOSE (collapse-safe) — the updater is applied to the prior result', async () => {
    const onUpdateVariables = vi.fn();
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onUpdateVariables })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-var-add'));
    await userEvent.click(screen.getByTestId('http-environment-var-add'));
    const first = onUpdateVariables.mock.calls[0]![1]([]);
    // The second updater runs against the FIRST add's result, not the prop.
    const second = onUpdateVariables.mock.calls[1]![1](first);
    expect(second).toHaveLength(2);
  });

  it('editing a variable key fires the updater with the patched key', async () => {
    const onUpdateVariables = vi.fn();
    render(
      <HttpEnvironmentManager
        {...props({
          environments: [env('e1', 'Dev', [v('r1', '', '', false)])],
          onUpdateVariables,
        })}
      />
    );
    await userEvent.type(screen.getByTestId('http-environment-var-key'), 'H');
    const [id, updater] = onUpdateVariables.mock.calls.at(-1)!;
    expect(id).toBe('e1');
    expect(updater([v('r1', '', '', false)])).toEqual([v('r1', 'H', '', false)]);
  });

  it('the secret toggle renders the value input as a masked password field', async () => {
    const onUpdateVariables = vi.fn();
    const { rerender } = render(
      <HttpEnvironmentManager
        {...props({
          environments: [env('e1', 'Dev', [v('r1', 'token', 'sk', false)])],
          onUpdateVariables,
        })}
      />
    );
    expect(
      screen.getByTestId('http-environment-var-value').getAttribute('type')
    ).toBe('text');
    await userEvent.click(screen.getByTestId('http-environment-var-secret'));
    const [, updater] = onUpdateVariables.mock.calls.at(-1)!;
    expect(updater([v('r1', 'token', 'sk', false)])).toEqual([
      v('r1', 'token', 'sk', true),
    ]);
    rerender(
      <HttpEnvironmentManager
        {...props({
          environments: [env('e1', 'Dev', [v('r1', 'token', 'sk', true)])],
          onUpdateVariables,
        })}
      />
    );
    expect(
      screen.getByTestId('http-environment-var-value').getAttribute('type')
    ).toBe('password');
  });

  it('delete variable fires the updater that filters the removed row by id', async () => {
    const onUpdateVariables = vi.fn();
    const rows = [v('r1', 'a', '1'), v('r2', 'b', '2')];
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', rows)], onUpdateVariables })}
      />
    );
    const deletes = screen.getAllByTestId('http-environment-var-delete');
    await userEvent.click(deletes[0]!);
    const [, updater] = onUpdateVariables.mock.calls.at(-1)!;
    expect(updater(rows)).toEqual([v('r2', 'b', '2')]);
  });

  it('delete environment fires onDelete with the env id', async () => {
    const onDelete = vi.fn();
    render(
      <HttpEnvironmentManager {...props({ environments: [env('e1', 'Dev')], onDelete })} />
    );
    await userEvent.click(screen.getByTestId('http-environment-delete'));
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  // ---------------- Slice 3b — secret-by-default heuristic ----------------

  it('secret-by-default: a token-like NEW key auto-suggests secret: true', async () => {
    const onUpdateVariables = vi.fn();
    const row = v('r1', 'API_TOKE', 'x', false);
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', [row])], onUpdateVariables })}
      />
    );
    // Type the final "N" → key becomes API_TOKEN, which looksSecret.
    await userEvent.type(screen.getByTestId('http-environment-var-key'), 'N');
    const [, updater] = onUpdateVariables.mock.calls.at(-1)!;
    const next = updater([row]);
    expect(next[0]).toMatchObject({ key: 'API_TOKEN', secret: true });
  });

  it('secret-by-default: a non-secret-looking key leaves secret: false', async () => {
    const onUpdateVariables = vi.fn();
    const row = v('r1', 'hos', 'x', false);
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', [row])], onUpdateVariables })}
      />
    );
    await userEvent.type(screen.getByTestId('http-environment-var-key'), 't');
    const [, updater] = onUpdateVariables.mock.calls.at(-1)!;
    expect(updater([row])).toEqual([v('r1', 'host', 'x', false)]);
  });

  it('secret-by-default: NEVER overrides a user who already unset secret on a token-like key', async () => {
    const onUpdateVariables = vi.fn();
    // User typed a token-like key but explicitly UNSET secret. Editing the
    // key again (still token-like) must NOT re-flip secret on.
    const row = v('r1', 'API_TOKEN', 'x', false);
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', [row])], onUpdateVariables })}
      />
    );
    // Append a char → key is API_TOKENS (still matches), old key matched too.
    await userEvent.type(screen.getByTestId('http-environment-var-key'), 'S');
    const [, updater] = onUpdateVariables.mock.calls.at(-1)!;
    const next = updater([row]);
    expect(next[0].secret).toBe(false);
  });

  // ------------------------ Slice 3b — duplicate env ----------------------

  it('the duplicate button fires onDuplicate with the env id', async () => {
    const onDuplicate = vi.fn();
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onDuplicate })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-duplicate'));
    expect(onDuplicate).toHaveBeenCalledWith('e1');
  });

  // -------------------------- Slice 3b — export ---------------------------

  it('export copies the share-safe JSON to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onExport = vi.fn(
      () => '{"version":1,"name":"Dev","variables":[]}'
    );
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onExport })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-export'));
    expect(onExport).toHaveBeenCalledWith('e1');
    expect(writeText).toHaveBeenCalledWith(
      '{"version":1,"name":"Dev","variables":[]}'
    );
  });

  // -------------------------- Slice 3b — import ---------------------------

  it('import: textarea → confirm calls onImport with the pasted JSON', async () => {
    const onImport = vi.fn(() => ({ ok: true as const, id: 'new-env' }));
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onImport })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-import'));
    const blob = '{"version":1,"name":"Imported","variables":[]}';
    fireEvent.change(screen.getByTestId('http-environment-import-textarea'), {
      target: { value: blob },
    });
    await userEvent.click(screen.getByTestId('http-environment-import-confirm'));
    expect(onImport).toHaveBeenCalledWith(blob);
    // The import panel closes on success.
    expect(screen.queryByTestId('http-environment-import-textarea')).toBeNull();
  });

  it('import: a failed parse keeps the panel open (does not close)', async () => {
    const onImport = vi.fn(() => ({ ok: false as const }));
    render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev')], onImport })}
      />
    );
    await userEvent.click(screen.getByTestId('http-environment-import'));
    fireEvent.change(screen.getByTestId('http-environment-import-textarea'), {
      target: { value: 'garbage' },
    });
    await userEvent.click(screen.getByTestId('http-environment-import-confirm'));
    expect(onImport).toHaveBeenCalledWith('garbage');
    // Still open so the user can fix the JSON.
    expect(
      screen.queryByTestId('http-environment-import-textarea')
    ).not.toBeNull();
  });

  // ------------------------- Slice 3b — reorder ---------------------------

  it('renders a drag handle per variable row + uses stable variable.id keys', () => {
    render(
      <HttpEnvironmentManager
        {...props({
          environments: [
            env('e1', 'Dev', [v('r1', 'a', '1'), v('r2', 'b', '2')]),
          ],
        })}
      />
    );
    expect(screen.getAllByTestId('http-environment-var-drag')).toHaveLength(2);
    expect(screen.getAllByTestId('http-environment-var-row')).toHaveLength(2);
  });

  it('stable React keys: reordering the variables array does not duplicate rows', () => {
    const rows = [v('r1', 'a', '1'), v('r2', 'b', '2')];
    const { rerender } = render(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', rows)] })}
      />
    );
    // Simulate a drag-reorder result (arrayMove swaps the two rows).
    rerender(
      <HttpEnvironmentManager
        {...props({ environments: [env('e1', 'Dev', [rows[1]!, rows[0]!])] })}
      />
    );
    const keyInputs = screen.getAllByTestId(
      'http-environment-var-key'
    ) as HTMLInputElement[];
    expect(keyInputs.map((i) => i.value)).toEqual(['b', 'a']);
  });

  it('renders the ES tuteo locale (Gestiona / Agrega, never voseo)', async () => {
    await i18next.changeLanguage('es');
    render(<HttpEnvironmentManager {...props({ environments: [env('e1', 'Dev')] })} />);
    expect(
      screen.getByTestId('http-environment-manager').textContent
    ).toContain('Entornos HTTP');
    expect(screen.getByTestId('http-environment-add').textContent).toContain(
      'Agrega entorno'
    );
    expect(screen.getByTestId('http-environment-import').textContent).toContain(
      'Importa'
    );
    // Voseo guard — none of these forms may appear in the rendered copy.
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('Agregá');
    expect(body).not.toContain('Gestioná');
    expect(body).not.toContain('Eliminá');
    expect(body).not.toContain('Duplicá');
    expect(body).not.toContain('Importá');
    expect(body).not.toContain('Exportá');
  });
});
