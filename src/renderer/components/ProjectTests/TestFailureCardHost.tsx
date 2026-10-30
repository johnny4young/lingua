import { useEffect, useState, type ComponentType } from 'react';
import { useProjectTestStore } from '../../stores/projectTestStore';
import type { TestFailureCardProps } from './TestFailureCard';

let cardPromise: Promise<{ TestFailureCard: ComponentType<TestFailureCardProps> }> | null = null;

/** Loads the failure card the first time a failed test is opened from the Tests tab. */
export function TestFailureCardHost(props: TestFailureCardProps) {
  const focused = useProjectTestStore(state => state.focusedFailure !== null);
  const [Card, setCard] = useState<ComponentType<TestFailureCardProps> | null>(null);

  useEffect(() => {
    if (!focused || Card) return;
    let active = true;
    cardPromise ??= import('./TestFailureCard');
    void cardPromise
      .then(module => {
        if (active) setCard(() => module.TestFailureCard);
      })
      .catch((error: unknown) => console.error('[editor] failed to load the test failure card', error));
    return () => {
      active = false;
    };
  }, [focused, Card]);

  return Card && focused ? <Card {...props} /> : null;
}
