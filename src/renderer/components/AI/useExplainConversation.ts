import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, ExplainErrorRequest } from '../../../shared/ai/explainError';
import { runChatCompletion, type AiChatResult } from '../../runtime/aiClient';
import { aiFailureMessage } from '../../runtime/aiFailureMessage';
import { useAiConfigStore } from '../../stores/aiConfigStore';
import { firstCodeBlock } from './answerCode';

export type ExplainPhase =
  | { readonly kind: 'preview' }
  | { readonly kind: 'streaming'; readonly partial: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'confirm-apply'; readonly suggested: string; readonly rerun: boolean }
  | { readonly kind: 'error'; readonly message: string };

/**
 * One explain conversation: the approved payload, every completed exchange and
 * the streaming state. Shared by the modal and the anchored panel. Nothing is
 * sent until `send(request.messages)` runs from an explicit click.
 */
export function useExplainConversation({
  request,
  runChatCompletionImpl,
  initialTranscript = [],
  onTranscriptChange,
}: {
  request: ExplainErrorRequest;
  runChatCompletionImpl?: typeof runChatCompletion;
  /** A thread kept elsewhere (the panel keeps one per tab) to continue from. */
  initialTranscript?: readonly ChatMessage[];
  onTranscriptChange?: (transcript: readonly ChatMessage[]) => void;
}) {
  const { t } = useTranslation();
  const endpoint = useAiConfigStore((s) => s.endpoint);
  const apiKey = useAiConfigStore((s) => s.apiKey);
  const model = useAiConfigStore((s) => s.model);
  const [phase, setPhase] = useState<ExplainPhase>(initialTranscript.length > 0 ? { kind: 'done' } : { kind: 'preview' });
  const activeControllerRef = useRef<AbortController | null>(null);
  // Chat models are stateless, so a follow-up re-sends this whole array; the
  // visible transcript is therefore the preview of every later turn.
  const [transcript, setTranscriptState] = useState<readonly ChatMessage[]>(initialTranscript);
  const send = runChatCompletionImpl ?? runChatCompletion;

  const setTranscript = (next: readonly ChatMessage[]) => {
    setTranscriptState(next);
    onTranscriptChange?.(next);
  };

  useEffect(
    () => () => {
      activeControllerRef.current?.abort('dialog-unmounted');
      activeControllerRef.current = null;
    },
    []
  );

  function abort(reason: string): void {
    activeControllerRef.current?.abort(reason);
    activeControllerRef.current = null;
  }

  async function sendMessages(messages: readonly ChatMessage[]): Promise<void> {
    abort('superseded');
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setPhase({ kind: 'streaming', partial: '' });
    try {
      const result: AiChatResult = await send(
        { messages, model },
        { endpoint, apiKey, model },
        {
          signal: controller.signal,
          onChunk: (textSoFar) => {
            if (!controller.signal.aborted) setPhase({ kind: 'streaming', partial: textSoFar });
          },
        }
      );
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTranscript([...messages, { role: 'assistant', content: result.content }]);
        setPhase({ kind: 'done' });
      } else {
        // Keep the attempted messages so a mid-conversation retry can resend.
        setTranscript(messages);
        setPhase({ kind: 'error', message: aiFailureMessage(result, t) });
      }
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    }
  }

  function retry(): void {
    // A first-attempt failure returns to the consent preview (re-approve); a
    // failed follow-up resends the conversation, already approved turn by turn.
    if (transcript.length <= request.messages.length) {
      setTranscript([]);
      setPhase({ kind: 'preview' });
    } else void sendMessages(transcript);
  }

  function ask(question: string): void {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    void sendMessages([...transcript, { role: 'user', content: trimmed }]);
  }

  const lastAssistant = [...transcript].reverse().find((m) => m.role === 'assistant');
  return {
    phase,
    setPhase,
    transcript,
    // Everything after the approved [system, user] payload is a visible exchange.
    exchanges: transcript.slice(request.messages.length),
    lastAnswer: lastAssistant?.content ?? null,
    suggestedCode: lastAssistant ? firstCodeBlock(lastAssistant.content) : null,
    start: () => void sendMessages(request.messages),
    retry,
    ask,
    abort,
  };
}
