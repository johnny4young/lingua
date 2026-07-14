/**
 * RL-069 Slice 2 — Cross-panel coverage of the ⚡ Apply button +
 * Mod+Shift+A descriptor wiring through `UtilityToolbar`. We pick one
 * panel per shape (live transform, mode-flip, generator carve-out,
 * dual-input) so a regression in any of these axes shows up.
 *
 * Pure helper coverage of the detect predicates lives in
 * `tests/utils/developerUtilities.test.ts`; this suite asserts the
 * UI plumbing.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { useUtilityOutputStore } from '../../src/renderer/stores/utilityOutputStore';

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
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('UtilityToolbar Apply (RL-069 Slice 2)', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    useUtilityOutputStore.getState().clearProvider();
    useUtilityOutputStore.getState().clearApplyHandler();
  });

  it('JSON: Apply enabled with valid input, disabled after clearing', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Default seed is valid JSON.
    const apply = await screen.findByTestId('utility-apply-button');
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    // Clear the input — Apply turns off.
    const inputs = screen.getAllByLabelText('Input');
    const jsonInput = inputs[0] as HTMLTextAreaElement;
    await user.clear(jsonInput);
    fireEvent.change(jsonInput, { target: { value: 'not json' } });

    await waitFor(() => {
      expect(
        (screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled
      ).toBe(true);
    });
  });

  it('JSON: registers an apply descriptor whose run reformats the input', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await waitFor(() => {
      expect(useUtilityOutputStore.getState().getApplyHandler()).not.toBeNull();
    });

    const handler = useUtilityOutputStore.getState().getApplyHandler();
    const descriptor = handler?.();
    expect(descriptor?.enabled).toBe(true);
    expect(descriptor?.toolNameKey).toBe('utilities.tool.json.titleLabel');

    // Click Apply on a minified input — it should reformat to multi-line.
    const inputs = screen.getAllByLabelText('Input');
    const jsonInput = inputs[0] as HTMLTextAreaElement;
    await user.clear(jsonInput);
    fireEvent.change(jsonInput, { target: { value: '{"a":1,"b":2}' } });

    await waitFor(() => {
      expect(
        (screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled
      ).toBe(false);
    });

    await user.click(screen.getByTestId('utility-apply-button'));
    await waitFor(() => {
      expect(jsonInput.value).toContain('\n');
    });
  });

  it('Base64: Apply auto-flips to decode when input looks base64', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="base64" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Default seed is plain text in encode mode. Replace with a base64 paste.
    const inputs = screen.getAllByLabelText('Input');
    const textarea = inputs[0] as HTMLTextAreaElement;
    await user.clear(textarea);
    fireEvent.change(textarea, { target: { value: 'TGluZ3Vh' } });

    const apply = await screen.findByTestId('utility-apply-button');
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByTestId('utility-apply-button'));

    // After Apply, the Decode toggle should be active. The mode toggles
    // are rendered via plain buttons; the active one carries the
    // primary-soft / primary classes.
    await waitFor(() => {
      const decodeButton = screen.getByRole('button', { name: 'Decode' });
      expect(decodeButton.className).toMatch(/text-primary/);
    });
  });

  it('URL: Apply auto-flips to decode and publishes the decoded output', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getAllByLabelText('Input')[0] as HTMLTextAreaElement;
    await user.clear(input);
    fireEvent.change(input, { target: { value: 'name%3DLingua%20utils' } });

    await user.click(await screen.findByTestId('utility-apply-button'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Decode' }).className).toMatch(/text-primary/);
      expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe(
        'name=Lingua utils'
      );
      expect(useUtilityOutputStore.getState().getProvider()?.()).toBe('name=Lingua utils');
    });
  });

  it('HTML Entity: Apply encodes raw HTML and decodes encoded entities', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="html-entity" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const mode = await screen.findByTestId('html-entity-mode') as HTMLSelectElement;
    await screen.findByTestId('utility-apply-button');

    // Default input is raw HTML. Apply should keep the encoder path,
    // not flip to Decode just because a tag-shaped payload is present.
    expect(mode.value).toBe('encode-named');
    await user.click(screen.getByTestId('utility-apply-button'));
    await waitFor(() => expect(mode.value).toBe('encode-named'));

    const input = screen.getByTestId('html-entity-input') as HTMLTextAreaElement;
    await user.clear(input);
    fireEvent.change(input, { target: { value: '&lt;span&gt;ok&lt;/span&gt;' } });
    await waitFor(() => {
      expect((screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId('utility-apply-button'));

    await waitFor(() => expect(mode.value).toBe('decode'));
  });

  it('YAML ↔ JSON: Apply carries a pasted JSON payload into JSON-to-YAML mode', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="yaml-json" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = await screen.findByTestId('yaml-json-input') as HTMLTextAreaElement;
    const mode = screen.getByTestId('yaml-json-mode') as HTMLSelectElement;
    await screen.findByTestId('utility-apply-button');
    const pasted = '{"name":"Lingua","tools":["yaml","json"]}';

    await user.clear(input);
    fireEvent.change(input, { target: { value: pasted } });
    await waitFor(() => {
      expect((screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId('utility-apply-button'));

    await waitFor(() => {
      expect(mode.value).toBe('json-to-yaml');
      expect((screen.getByTestId('yaml-json-input') as HTMLTextAreaElement).value).toBe(pasted);
    });
  });

  it('JSON ↔ CSV: Apply carries a pasted CSV payload into CSV-to-JSON mode', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="json-csv" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = await screen.findByTestId('json-csv-input') as HTMLTextAreaElement;
    const mode = screen.getByTestId('json-csv-mode') as HTMLSelectElement;
    await screen.findByTestId('utility-apply-button');
    const pasted = 'name,score\nLingua,99';

    await user.clear(input);
    fireEvent.change(input, { target: { value: pasted } });
    await waitFor(() => {
      expect((screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByTestId('utility-apply-button'));

    await waitFor(() => {
      expect(mode.value).toBe('csv-to-json');
      expect((screen.getByTestId('json-csv-input') as HTMLTextAreaElement).value).toBe(pasted);
    });
  });

  it('Random String: pure generator panel exposes no Apply button', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.queryByTestId('utility-apply-button')).toBeNull();
  });

  it('Diff: Apply requires both panes filled (dual-input carve-out)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Default seeds are both filled — Apply is enabled.
    const apply = await screen.findByTestId('utility-apply-button');
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    // Empty out the right pane — Apply turns off.
    const right = screen.getByLabelText('Updated') as HTMLTextAreaElement;
    await user.clear(right);

    await waitFor(() => {
      expect(
        (screen.getByTestId('utility-apply-button') as HTMLButtonElement).disabled
      ).toBe(true);
    });
  });

  it('Hash: output provider returns the hex digest only when result is ok', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="hash" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // After mount + the live useEffect resolves, an output provider
    // should be registered and produce a non-null hex string for the
    // seeded "Lingua" input.
    await waitFor(() => {
      const provider = useUtilityOutputStore.getState().getProvider();
      expect(provider).not.toBeNull();
    });

    await waitFor(
      () => {
        const value = useUtilityOutputStore.getState().getProvider()?.();
        expect(typeof value).toBe('string');
        expect(value).toMatch(/^[0-9a-f]+$/);
      },
      { timeout: 2000 }
    );
  });
});
