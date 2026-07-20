import { useCallback, useDebugValue, useMemo, useState } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useRegisterUtilityOutput } from '../../hooks/useRegisterUtilityOutput';
import { usePendingUtilityInput } from './usePendingUtilityInput';

export interface TransformUtilityResult {
  output: string;
  errorKey: string | null;
}

export function useTransformUtilityPanel({
  utilityId,
  initialInput,
  transform,
  onPendingInput,
}: {
  utilityId: DeveloperUtilityId;
  initialInput: string;
  transform: (input: string) => TransformUtilityResult;
  /**
   * internal — invoked right before a smart-pasted seed replaces the
   * input, so a panel can flip its own mode state (e.g. Base64 switches
   * to decode for a pasted encoded value).
   */
  onPendingInput?: (input: string) => void;
}): {
  input: string;
  setInput: (value: string) => void;
  output: string;
  errorKey: string | null;
} {
  const [input, setInput] = useState(initialInput);
  // internal — adopting panels consume a smart-pasted seed for free.
  usePendingUtilityInput(utilityId, pending => {
    onPendingInput?.(pending);
    setInput(pending);
  });
  const { output, errorKey } = useMemo(() => transform(input), [input, transform]);
  const outputProvider = useCallback(() => (errorKey ? null : output || null), [errorKey, output]);

  useRegisterUtilityOutput(outputProvider);
  useDebugValue(`${utilityId}:${errorKey ? 'error' : 'ready'}`);

  return { input, setInput, output, errorKey };
}
