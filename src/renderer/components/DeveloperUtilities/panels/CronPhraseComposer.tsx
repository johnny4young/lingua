/**
 * Phrase → cron composer. The deterministic engine (`utils/cronPhrase`) is
 * always the first answer: instant, offline, bilingual, and honest about what
 * it could not read. Only when it fails does the AI affordance appear, and the
 * model's answer never reaches the expression field without passing the same
 * validator everything else uses.
 *
 * The AI tier mirrors Explain Error exactly: LOCAL_AI entitlement, the
 * endpoint/key/model from Settings → AI, and a configure prompt that deep
 * links there when unset — including suggestions for the lightest local
 * models that handle this task, since a schedule phrase does not need a
 * frontier model.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Sparkles, TriangleAlert } from 'lucide-react';
import { FieldLabel, StatusMessage, UtilityInput } from '../panelPrimitives';
import { phraseToCron } from '../../../utils/cronPhrase';
import type { CronPhraseNote, CronPhraseResult } from '../../../utils/cronPhrase';
import { parseCronExpression } from '../../../utils/cronParser';
import { runChatCompletion } from '../../../runtime/aiClient';
import { isAiConfigured, useAiConfigStore } from '../../../stores/aiConfigStore';
import { useEntitlement } from '../../../hooks/useEntitlement';
import { emitCommand } from '../../../stores/commandBus';

interface CronPhraseComposerProps {
  /** Receives every validated expression the composer produces. */
  readonly onExpression: (expression: string) => void;
}

type AiPhase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; expression: string }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

const AI_SYSTEM_PROMPT = [
  'You convert natural-language scheduling phrases (English or Spanish) into standard 5-field cron expressions (minute hour day-of-month month day-of-week).',
  'Reply with ONLY the cron expression: five space-separated fields, no code fences, no prose.',
  'If the phrase cannot be expressed as a single cron expression, reply with exactly: IMPOSSIBLE',
].join(' ');

function NoteChips({ notes, testid }: { notes: readonly CronPhraseNote[]; testid: string }) {
  const { t } = useTranslation();
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid={testid}>
      {notes.map(note => (
        <li
          key={note.key}
          className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-caption text-muted"
        >
          {t(note.key, note.values)}
        </li>
      ))}
    </ul>
  );
}

function CaveatCards({ caveats }: { caveats: readonly CronPhraseNote[] }) {
  const { t } = useTranslation();
  if (caveats.length === 0) return null;
  return (
    <div className="grid gap-1.5" data-testid="cron-phrase-caveats">
      {caveats.map(caveat => (
        <p
          key={caveat.key}
          className="flex items-start gap-2 rounded-xl border border-warning-fg/30 bg-warning-fg/5 px-3 py-2 text-caption leading-5 text-foreground"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
          <span>{t(caveat.key, caveat.values)}</span>
        </p>
      ))}
    </div>
  );
}

export function CronPhraseComposer({ onExpression }: CronPhraseComposerProps) {
  const { t } = useTranslation();
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState<CronPhraseResult | null>(null);
  const [aiPhase, setAiPhase] = useState<AiPhase>({ kind: 'idle' });

  const entitled = useEntitlement('LOCAL_AI');
  const endpoint = useAiConfigStore(s => s.endpoint);
  const apiKey = useAiConfigStore(s => s.apiKey);
  const model = useAiConfigStore(s => s.model);
  const configured = isAiConfigured({ endpoint, apiKey, model });

  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort('unmounted'), []);

  function generate(nextPhrase: string): void {
    activeRequest.current?.abort('superseded');
    setAiPhase({ kind: 'idle' });
    const next = phraseToCron(nextPhrase);
    setResult(next);
    if (next.ok) onExpression(next.expression);
  }

  async function interpretWithAi(): Promise<void> {
    activeRequest.current?.abort('superseded');
    const controller = new AbortController();
    activeRequest.current = controller;
    setAiPhase({ kind: 'busy' });

    const config = { endpoint, apiKey, model };
    const ask = (content: string) =>
      runChatCompletion(
        {
          model,
          messages: [
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content },
          ],
        },
        config,
        { signal: controller.signal }
      );

    // One retry, feeding the validator's rejection back to the model. More
    // than that just burns tokens on a model that cannot do the task.
    let answer = await ask(phrase);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (controller.signal.aborted) return;
      if (!answer.ok) {
        setAiPhase({ kind: 'error', message: answer.message });
        return;
      }
      const candidate = answer.content.trim().replace(/^`+|`+$/g, '');
      if (candidate === 'IMPOSSIBLE') break;
      const validated = await parseCronExpression(candidate, { locale: 'en', nextCount: 1 });
      if (validated.ok) {
        if (controller.signal.aborted) return;
        setAiPhase({ kind: 'done', expression: candidate });
        onExpression(candidate);
        return;
      }
      if (attempt === 0) {
        answer = await ask(
          `${phrase}\n\nYour previous answer "${candidate}" was rejected by a cron parser (${
            validated.message ?? 'invalid'
          }). Reply with ONLY a corrected 5-field cron expression.`
        );
      }
    }
    if (!controller.signal.aborted) setAiPhase({ kind: 'invalid' });
  }

  const failed = result !== null && !result.ok && result.reason !== 'empty';

  return (
    <div className="grid gap-2" data-testid="cron-phrase-composer">
      <FieldLabel>{t('utilities.tool.cron.phrase.label')}</FieldLabel>
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          generate(phrase);
        }}
      >
        <UtilityInput
          aria-label={t('utilities.tool.cron.phrase.label')}
          data-testid="cron-phrase-input"
          value={phrase}
          onChange={event => setPhrase(event.target.value)}
          placeholder={t('utilities.tool.cron.phrase.placeholder') ?? undefined}
          spellCheck={false}
        />
        <button
          type="submit"
          className="button-secondary shrink-0 whitespace-nowrap"
          data-testid="cron-phrase-generate"
        >
          {t('utilities.tool.cron.phrase.generate')}
        </button>
      </form>

      <p className="text-caption text-muted">
        {t('utilities.tool.cron.phrase.examples.label')}{' '}
        {(['a', 'b', 'c'] as const).map(id => {
          const example = t(`utilities.tool.cron.phrase.examples.${id}`);
          return (
            <button
              key={id}
              type="button"
              className="focus-ring mr-1.5 rounded-full border border-border/60 px-2 py-0.5 text-caption text-muted transition-colors hover:border-border hover:text-foreground"
              data-testid={`cron-phrase-example-${id}`}
              onClick={() => {
                setPhrase(example);
                generate(example);
              }}
            >
              {example}
            </button>
          );
        })}
      </p>

      {result?.ok ? (
        <div className="grid gap-1.5" data-testid="cron-phrase-success">
          <p className="flex items-center gap-1.5 text-body-sm text-foreground">
            <Check size={14} className="text-success-fg" aria-hidden />
            <span>
              {t('utilities.tool.cron.phrase.success')}{' '}
              <code className="font-mono">{result.expression}</code>
            </span>
          </p>
          <NoteChips notes={result.assumptions} testid="cron-phrase-assumptions" />
          <CaveatCards caveats={result.caveats} />
        </div>
      ) : null}

      {result !== null && !result.ok && result.reason === 'unsupported' ? (
        <StatusMessage
          message={result.detail ? t(result.detail.key, result.detail.values) : ''}
          tone="error"
        />
      ) : null}

      {result !== null && !result.ok && result.reason === 'unrecognized' ? (
        <div className="grid gap-1" data-testid="cron-phrase-unrecognized">
          <StatusMessage message={t('utilities.tool.cron.phrase.unrecognized')} tone="error" />
          {result.leftover && result.leftover.length > 0 ? (
            <p className="font-mono text-caption text-muted">
              {t('utilities.tool.cron.phrase.unrecognizedTokens', {
                tokens: result.leftover.join(', '),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <div className="grid gap-1.5 rounded-xl border border-border/70 bg-background/60 p-3">
          {!entitled ? (
            <p className="text-caption text-muted" data-testid="cron-phrase-ai-upsell">
              {t('utilities.tool.cron.phrase.ai.upsell')}
            </p>
          ) : !configured ? (
            <div className="grid gap-1.5" data-testid="cron-phrase-ai-unconfigured">
              <p className="text-caption text-muted">
                {t('utilities.tool.cron.phrase.ai.unconfigured')}
              </p>
              <p className="text-caption text-muted">
                {t('utilities.tool.cron.phrase.ai.suggestion')}
              </p>
              <button
                type="button"
                className="button-secondary justify-self-start"
                data-testid="cron-phrase-ai-open-settings"
                onClick={() => emitCommand('settings.navigate', { tab: 'account', targetId: 'section-ai' })}
              >
                {t('utilities.tool.cron.phrase.ai.openSettings')}
              </button>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <button
                type="button"
                className="button-secondary inline-flex items-center gap-1.5 justify-self-start"
                data-testid="cron-phrase-ai-run"
                disabled={aiPhase.kind === 'busy'}
                onClick={() => void interpretWithAi()}
              >
                <Sparkles size={14} aria-hidden />
                {aiPhase.kind === 'busy'
                  ? t('utilities.tool.cron.phrase.ai.busy')
                  : t('utilities.tool.cron.phrase.ai.action')}
              </button>
              <p className="text-caption text-muted">{t('utilities.tool.cron.phrase.ai.hint')}</p>
              {aiPhase.kind === 'done' ? (
                <p
                  className="flex items-center gap-1.5 text-body-sm text-foreground"
                  data-testid="cron-phrase-ai-verified"
                >
                  <Check size={14} className="text-success-fg" aria-hidden />
                  <span>
                    {t('utilities.tool.cron.phrase.ai.verified')}{' '}
                    <code className="font-mono">{aiPhase.expression}</code>
                  </span>
                </p>
              ) : null}
              {aiPhase.kind === 'invalid' ? (
                <StatusMessage message={t('utilities.tool.cron.phrase.ai.invalid')} tone="error" />
              ) : null}
              {aiPhase.kind === 'error' ? (
                <StatusMessage
                  message={t('utilities.tool.cron.phrase.ai.error', { message: aiPhase.message })}
                  tone="error"
                />
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
