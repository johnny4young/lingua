/**
 * implementation — the shared "Explain this error" trigger. Verifies the entitlement
 * gate (invisible without LOCAL_AI) and that clicking opens the consent
 * dialog without sending anything. The dialog's own behavior is covered by
 * ExplainErrorDialog.test.tsx; this only asserts the button contract every
 * host surface (notebook / SQL / console / HTTP) relies on.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { ExplainErrorButton } from '../../../src/renderer/components/AI/ExplainErrorButton';

let entitled = true;
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

const baseProps = {
  errorMessage: 'boom',
  code: 'throw new Error("boom")',
  language: 'javascript',
  testId: 'test-explain-trigger',
};

describe('ExplainErrorButton', () => {
  beforeAll(async () => {
    if (!i18next.isInitialized) await initI18n('en');
  });
  beforeEach(() => {
    entitled = true;
  });

  it('renders nothing without the LOCAL_AI entitlement', () => {
    entitled = false;
    render(<ExplainErrorButton {...baseProps} />);
    expect(screen.queryByTestId('test-explain-trigger')).toBeNull();
  });

  it('renders the trigger for an entitled user and does not mount the dialog until clicked', () => {
    render(<ExplainErrorButton {...baseProps} />);
    expect(screen.getByTestId('test-explain-trigger')).toBeTruthy();
    // Consent-first: nothing (not even the dialog) exists until the click.
    expect(screen.queryByTestId('ai-explain-dialog')).toBeNull();
  });

  it('opens the consent dialog on click', () => {
    render(<ExplainErrorButton {...baseProps} />);
    fireEvent.click(screen.getByTestId('test-explain-trigger'));
    expect(screen.getByTestId('ai-explain-dialog')).toBeTruthy();
  });
});
