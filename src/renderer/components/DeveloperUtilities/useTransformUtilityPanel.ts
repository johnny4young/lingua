import { useCallback, useDebugValue, useMemo, useState } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useRegisterUtilityOutput } from '../../hooks/useRegisterUtilityOutput';

export interface TransformUtilityResult {
  output: string;
  errorKey: string | null;
}

export function useTransformUtilityPanel({
  utilityId,
  initialInput,
  transform,
}: {
  utilityId: DeveloperUtilityId;
  initialInput: string;
  transform: (input: string) => TransformUtilityResult;
}): {
  input: string;
  setInput: (value: string) => void;
  output: string;
  errorKey: string | null;
} {
  const [input, setInput] = useState(initialInput);
  const { output, errorKey } = useMemo(() => transform(input), [input, transform]);
  const outputProvider = useCallback(() => (errorKey ? null : output || null), [errorKey, output]);

  useRegisterUtilityOutput(outputProvider);
  useDebugValue(`${utilityId}:${errorKey ? 'error' : 'ready'}`);

  return { input, setInput, output, errorKey };
}
