import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { SecretStorageNote } from '../../../src/renderer/components/ui/SecretStorageNote';
import type { SecretVaultBridge, SecretStorageMode } from '../../../src/shared/secretVault';

const host = window as unknown as { lingua?: { secrets?: SecretVaultBridge } };
const original = host.lingua;

function withVault(mode: SecretStorageMode, backend?: string) {
  host.lingua = {
    ...(original ?? {}),
    secrets: { status: async () => ({ mode, backend }) } as unknown as SecretVaultBridge,
  };
}

describe('SecretStorageNote', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    host.lingua = original;
  });

  it('says secrets stay in the browser when there is no vault', () => {
    host.lingua = { ...(original ?? {}), secrets: undefined };
    render(<SecretStorageNote testId="note" />);
    expect(screen.getByTestId('note').textContent).toContain("Secrets are stored in this browser's local storage, not encrypted.");
  });

  it('says secrets are encrypted when the vault has a keyring', async () => {
    withVault('encrypted');
    render(<SecretStorageNote testId="note" />);
    expect(await screen.findByText('Secrets are encrypted on this device with the system keychain.')).toBeTruthy();
  });

  it('warns that secrets stay unencrypted when the system has no keyring', async () => {
    withVault('session', 'basic_text');
    render(<SecretStorageNote testId="note" />);
    expect(await screen.findByText('No system keyring available')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('local storage without encryption');
  });

  it('renders the Spanish copy', async () => {
    await i18next.changeLanguage('es');
    host.lingua = { ...(original ?? {}), secrets: undefined };
    render(<SecretStorageNote testId="note" />);
    expect(screen.getByTestId('note').textContent).toContain('sin cifrar');
    await i18next.changeLanguage('en');
  });
});
