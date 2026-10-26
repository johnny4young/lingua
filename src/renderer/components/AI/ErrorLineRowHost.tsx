import { useEffect, useState, type ComponentType } from 'react';
import { useResultStore } from '../../stores/resultStore';
import type { ErrorLineRowProps } from './ErrorLineRow';

let rowPromise: Promise<{ ErrorLineRow: ComponentType<ErrorLineRowProps> }> | null = null;

/** Loads the inline error row the first time a run fails on a known line. */
export function ErrorLineRowHost(props: ErrorLineRowProps) {
  const failedOnLine = useResultStore((state) => typeof state.error?.line === 'number');
  const [Row, setRow] = useState<ComponentType<ErrorLineRowProps> | null>(null);

  useEffect(() => {
    if (!failedOnLine || Row) return;
    let active = true;
    rowPromise ??= import('./ErrorLineRow');
    void rowPromise
      .then((module) => {
        if (active) setRow(() => module.ErrorLineRow);
      })
      .catch((error: unknown) => console.error('[editor] failed to load the error row', error));
    return () => {
      active = false;
    };
  }, [failedOnLine, Row]);

  return Row ? <Row {...props} /> : null;
}
