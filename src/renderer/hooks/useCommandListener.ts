import { useEffect, useEffectEvent } from 'react';
import {
  subscribeCommand,
  type CommandListenerOptions,
  type RendererCommandListener,
  type RendererCommandName,
} from '../stores/commandBus';

/** Subscribe a React consumer to one typed renderer command. */
export function useCommandListener<K extends RendererCommandName>(
  name: K,
  listener: RendererCommandListener<K>,
  options?: CommandListenerOptions
): void {
  const onCommand = useEffectEvent(listener);

  const priority = options?.priority;
  const delivery = options?.delivery;

  useEffect(
    () =>
      subscribeCommand(name, (payload, context) => onCommand(payload, context), {
        priority,
        delivery,
      }),
    [delivery, name, priority]
  );
}
