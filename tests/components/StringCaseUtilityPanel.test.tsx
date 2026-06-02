/**
 * RL-068 — String Case Converter component tests. Pure helper is covered in
 * tests/utils/stringCase.test.ts, so this suite only checks the wiring:
 * every output cell receives a value, propagation is live, copy buttons are
 * present per casing, and ES copy resolves.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
  ),
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('StringCasePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders every casing for the seeded sample input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-case" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('string-case-camel').textContent).toBe('userProfilePage');
    expect(screen.getByTestId('string-case-pascal').textContent).toBe('UserProfilePage');
    expect(screen.getByTestId('string-case-snake').textContent).toBe('user_profile_page');
    expect(screen.getByTestId('string-case-kebab').textContent).toBe('user-profile-page');
    expect(screen.getByTestId('string-case-constant').textContent).toBe('USER_PROFILE_PAGE');
    expect(screen.getByTestId('string-case-sentence').textContent).toBe('User profile page');
    expect(screen.getByTestId('string-case-title').textContent).toBe('User Profile Page');
  });

  it('propagates edits to every output cell live', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-case" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('string-case-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'parseJSONValue');

    expect(screen.getByTestId('string-case-camel').textContent).toBe('parseJsonValue');
    expect(screen.getByTestId('string-case-snake').textContent).toBe('parse_json_value');
    expect(screen.getByTestId('string-case-constant').textContent).toBe('PARSE_JSON_VALUE');
  });

  it('renders the em-dash placeholder for each cell when input is empty', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-case" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('string-case-input') as HTMLTextAreaElement;
    await user.clear(input);

    for (const key of ['camel', 'pascal', 'snake', 'kebab', 'constant', 'sentence', 'title'] as const) {
      expect(screen.getByTestId(`string-case-${key}`).textContent).toBe('—');
    }
  });

  it('ships a dedicated copy button per casing cell', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-case" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    for (const key of ['camel', 'pascal', 'snake', 'kebab', 'constant', 'sentence', 'title'] as const) {
      expect(screen.getByTestId(`string-case-${key}-copy`)).toBeTruthy();
    }
  });

  it('localizes the panel headings to Spanish when i18next switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="string-case" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // The inner PanelSection title renders as an h3. Scope the query to h3
    // so the modal's outer h2 (also localized) does not collide.
    expect(screen.getByRole('heading', { level: 3, name: 'Recasar identificadores' })).toBeTruthy();
    expect(screen.getByText('Resultados por notación')).toBeTruthy();
  });
});
