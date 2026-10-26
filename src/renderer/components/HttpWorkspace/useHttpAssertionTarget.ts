import { useCallback, useEffect, type MutableRefObject } from 'react';
import type { HttpAssertion } from '../../../shared/httpWorkspaceSchema';

export type HttpAssertionTarget = (assertion: Omit<HttpAssertion, 'id'>) => void;

/** Points `targetRef` at the handler that adds a suggested assertion to the editor's draft. */
export function useHttpAssertionTarget(
  targetRef: MutableRefObject<HttpAssertionTarget | null> | undefined,
  assertions: readonly HttpAssertion[],
  applyAssertions: (next: HttpAssertion[]) => void,
  onAdd: () => void
): void {
  const add = useCallback<HttpAssertionTarget>(
    (assertion) => {
      onAdd();
      applyAssertions([...assertions, { id: crypto.randomUUID(), ...assertion }]);
    },
    [assertions, applyAssertions, onAdd]
  );
  useEffect(() => {
    if (!targetRef) return;
    targetRef.current = add;
    return () => {
      targetRef.current = null;
    };
  }, [targetRef, add]);
}
