import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => <div onClick={onClose}>{children}</div>,
  OverlayCard: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

describe('DeveloperUtilitiesModal', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('opens on the JSON utility by default', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);

    expect(screen.getByTestId('developer-utilities-modal')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pretty print' })).toBeTruthy();
  });

  it('supports opening directly into a selected utility', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="timestamp" />);

    expect(screen.getByRole('heading', { name: 'Timestamp Converter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use current time' })).toBeTruthy();
  });

  it('switches utilities and updates derived output live', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Base64 Encoder/ }));

    expect(screen.getByRole('heading', { name: 'Base64 Encoder' })).toBeTruthy();
    expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe(
      'TGluZ3VhIHV0aWxpdGllcw=='
    );

    await user.click(screen.getByRole('button', { name: 'Decode' }));
    await user.clear(screen.getByLabelText('Input'));
    await user.type(screen.getByLabelText('Input'), 'TGluZ3Vh');

    expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe('Lingua');
  });

  it('shows regex matches with capture groups and a count label', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    expect(screen.getByRole('heading', { name: 'Regex Tester' })).toBeTruthy();
    expect(screen.getByText('2 matches')).toBeTruthy();

    await user.clear(screen.getByLabelText('Test string'));
    await user.type(screen.getByLabelText('Test string'), 'none here');
    expect(screen.getByText('No matches for the current pattern.')).toBeTruthy();
  });

  it('surfaces color conversions for the current input', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="color" />);

    expect(screen.getByRole('heading', { name: 'Color Converter' })).toBeTruthy();
    expect(screen.getByText('rgb(79, 70, 229)')).toBeTruthy();
    expect(screen.getByText('Color parsed successfully.')).toBeTruthy();
  });

  it('reports a summary when comparing two different inputs in the diff viewer', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);

    expect(screen.getByRole('heading', { name: 'Diff Viewer' })).toBeTruthy();
    expect(
      screen.getByText((text) => text.startsWith('2 added,') && text.includes('1 removed'))
    ).toBeTruthy();
  });

  it('formats JSON input in place', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);

    const input = screen.getByLabelText('Input');
    fireEvent.change(input, { target: { value: '{"name":"Lingua"}' } });
    await user.click(screen.getByRole('button', { name: 'Pretty print' }));

    expect((screen.getByLabelText('Input') as HTMLTextAreaElement).value).toBe(
      '{\n  "name": "Lingua"\n}'
    );
  });
});
