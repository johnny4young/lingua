/**
 * CronPhraseComposer wiring tests. Engine semantics live in
 * tests/utils/cronPhrase.test.ts; this suite covers what the component adds:
 * generate flow feeding onExpression, assumption chips and caveat cards,
 * honest failure states, and the three AI tiers (upsell / configure deep link
 * with light-model suggestions / validated interpretation).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { CronPhraseComposer } from '../../src/renderer/components/DeveloperUtilities/panels/CronPhraseComposer';
import { useAiConfigStore } from '../../src/renderer/stores/aiConfigStore';

let entitled = true;
vi.mock('../../src/renderer/hooks/useEntitlement', () => ({
  useEntitlement: () => entitled,
}));

const runChatCompletion = vi.fn();
vi.mock('../../src/renderer/runtime/aiClient', () => ({
  runChatCompletion: (...args: unknown[]) => runChatCompletion(...args),
}));

const emitCommand = vi.fn();
vi.mock('../../src/renderer/stores/commandBus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/stores/commandBus')>();
  return { ...actual, emitCommand: (...args: unknown[]) => emitCommand(...args) };
});

function configureAi(configured: boolean): void {
  useAiConfigStore.setState(
    configured
      ? { endpoint: 'https://ai.local/v1/chat/completions', apiKey: 'key', model: 'llama3.2:1b' }
      : { endpoint: '', apiKey: '', model: '' }
  );
}

function generate(phrase: string): void {
  fireEvent.change(screen.getByTestId('cron-phrase-input'), { target: { value: phrase } });
  fireEvent.click(screen.getByTestId('cron-phrase-generate'));
}

describe('CronPhraseComposer', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    entitled = true;
    configureAi(false);
    runChatCompletion.mockReset();
    emitCommand.mockClear();
  });

  it('generates an expression from a phrase and reports it upward', () => {
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    generate('every 3 days at 8am');

    expect(onExpression).toHaveBeenCalledWith('0 8 */3 * *');
    expect(screen.getByTestId('cron-phrase-success').textContent).toContain('0 8 */3 * *');
    // The motivating caveat: day-of-month steps restart at month boundaries.
    expect(screen.getByTestId('cron-phrase-caveats').textContent).toContain('restarts');
  });

  it('renders assumption chips for the defaults it filled in', () => {
    render(<CronPhraseComposer onExpression={vi.fn()} />);
    generate('weekly');
    const chips = screen.getByTestId('cron-phrase-assumptions');
    expect(chips.textContent).toContain('Monday');
    expect(chips.textContent).toContain('00:00');
  });

  it('fails a phrase with unknown tokens and lists them instead of guessing', () => {
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    generate('deploy the flux capacitor at 8am');

    expect(onExpression).not.toHaveBeenCalled();
    expect(screen.getByTestId('cron-phrase-unrecognized').textContent).toContain(
      'deploy, flux, capacitor'
    );
  });

  it('explains impossible intents instead of approximating them', () => {
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    generate('cada 2 semanas a las 8');

    expect(onExpression).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot express a continuous/i)).toBeTruthy();
  });

  it('fills the input from an example chip and generates immediately', () => {
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    fireEvent.click(screen.getByTestId('cron-phrase-example-a'));
    expect(onExpression).toHaveBeenCalledWith('0 8 */3 * *');
  });

  it('shows the upsell instead of AI controls without the entitlement', () => {
    entitled = false;
    render(<CronPhraseComposer onExpression={vi.fn()} />);
    generate('deploy the flux capacitor');
    expect(screen.getByTestId('cron-phrase-ai-upsell')).toBeTruthy();
    expect(screen.queryByTestId('cron-phrase-ai-run')).toBeNull();
  });

  it('deep links to Settings → AI and suggests light models when unconfigured', () => {
    render(<CronPhraseComposer onExpression={vi.fn()} />);
    generate('deploy the flux capacitor');

    const card = screen.getByTestId('cron-phrase-ai-unconfigured');
    expect(card.textContent).toContain('llama3.2:1b');
    expect(card.textContent).toContain('qwen2.5:0.5b-instruct');

    fireEvent.click(screen.getByTestId('cron-phrase-ai-open-settings'));
    expect(emitCommand).toHaveBeenCalledWith('settings.navigate', {
      tab: 'account',
      targetId: 'section-ai',
    });
  });

  it('applies an AI answer only after the cron parser validates it', async () => {
    configureAi(true);
    runChatCompletion.mockResolvedValueOnce({ ok: true, content: '30 7 * * 2' });
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    generate('deploy the flux capacitor');

    fireEvent.click(screen.getByTestId('cron-phrase-ai-run'));
    await waitFor(() =>
      expect(screen.getByTestId('cron-phrase-ai-verified').textContent).toContain('30 7 * * 2')
    );
    expect(onExpression).toHaveBeenCalledWith('30 7 * * 2');
    expect(runChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries once with the validator error, then reports an invalid answer honestly', async () => {
    configureAi(true);
    runChatCompletion
      .mockResolvedValueOnce({ ok: true, content: 'not a cron' })
      .mockResolvedValueOnce({ ok: true, content: 'still not a cron' });
    const onExpression = vi.fn();
    render(<CronPhraseComposer onExpression={onExpression} />);
    generate('deploy the flux capacitor');

    fireEvent.click(screen.getByTestId('cron-phrase-ai-run'));
    await waitFor(() => expect(runChatCompletion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/could not produce a valid cron/i)).toBeTruthy());
    expect(onExpression).not.toHaveBeenCalled();
    // The retry prompt carries the validator's rejection back to the model.
    const retryMessages = runChatCompletion.mock.calls[1]?.[0]?.messages as Array<{
      content: string;
    }>;
    expect(retryMessages?.[1]?.content).toContain('rejected by a cron parser');
  });

  it('surfaces transport failures with the client message', async () => {
    configureAi(true);
    runChatCompletion.mockResolvedValueOnce({
      ok: false,
      kind: 'network',
      message: 'connection refused',
    });
    render(<CronPhraseComposer onExpression={vi.fn()} />);
    generate('deploy the flux capacitor');

    fireEvent.click(screen.getByTestId('cron-phrase-ai-run'));
    await waitFor(() => expect(screen.getByText(/connection refused/)).toBeTruthy());
  });

  it('renders the tuteo Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<CronPhraseComposer onExpression={vi.fn()} />);
    expect(screen.getByText('Describe el horario')).toBeTruthy();
    generate('cada 3 días a las 8am');
    expect(screen.getByTestId('cron-phrase-caveats').textContent).toContain('se reinicia');
  });
});
