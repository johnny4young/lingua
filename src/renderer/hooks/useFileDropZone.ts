import { useCallback, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

/**
 * RL-070 — drag-and-drop state machine for file drop zones.
 *
 * Returns:
 *
 *   - `state` — `'idle' | 'over' | 'dropping' | 'error'`. Drives the
 *     visual styling on the zone (use `<FileDropZone>` or wire your
 *     own classNames).
 *   - `handlers` — bind onto the target element. Internally tracks
 *     dragenter/leave with a depth counter so nested children do not
 *     flicker `over → idle → over`.
 *   - `reset` — call after the consumer surfaces an error to flip
 *     back to `idle`. Useful when validation fails after the file
 *     has been read but the visual should not stay red forever.
 *
 * Validation:
 *   - The optional `accept` predicate runs on EACH dragged item AND
 *     on the final dropped File. Returning false flips to `error`.
 *   - The first dropped file is dispatched; additional files are
 *     ignored so consumers never have to handle arrays.
 */
export type FileDropState = 'idle' | 'over' | 'dropping' | 'error';

interface UseFileDropZoneOptions {
  /**
   * Called with the resolved file once a drop succeeds validation. The
   * hook awaits the promise — while pending, state stays `'dropping'`
   * so the spinner / progress UI can show. Resolves the state back to
   * `idle` on success, `error` on rejection.
   */
  onFile: (file: File) => Promise<void> | void;
  /**
   * Optional sync validator. Receives a File-or-DataTransferItem
   * (depending on event phase) and returns true if accepted. When
   * omitted, every file is accepted.
   */
  accept?: (item: File | DataTransferItem) => boolean;
}

interface UseFileDropZoneReturn {
  state: FileDropState;
  handlers: {
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
  };
  processFile: (file: File | null | undefined) => void;
  reset: () => void;
}

export function useFileDropZone({
  onFile,
  accept,
}: UseFileDropZoneOptions): UseFileDropZoneReturn {
  const [state, setState] = useState<FileDropState>('idle');
  // dragEnter/leave fire for every nested element. Depth counter keeps
  // the zone "over" until ALL nested enters are matched by leaves.
  const depthRef = useRef(0);

  const handleDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      if (!event.dataTransfer) return;
      // Sniff items to know if anything in the drag is acceptable.
      const items = Array.from(event.dataTransfer.items);
      const ok = accept ? items.some((item) => accept(item)) : items.length > 0;
      setState(ok ? 'over' : 'error');
    },
    [accept]
  );

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      // Tell the OS we'll accept the drop with a copy gesture cursor.
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setState('idle');
  }, []);

  const processFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) {
        setState('error');
        return;
      }
      if (accept && !accept(file)) {
        setState('error');
        return;
      }
      setState('dropping');
      Promise.resolve(onFile(file))
        .then(() => setState('idle'))
        .catch(() => setState('error'));
    },
    [accept, onFile]
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = 0;
      processFile(event.dataTransfer?.files[0]);
    },
    [processFile]
  );

  const reset = useCallback(() => {
    depthRef.current = 0;
    setState('idle');
  }, []);

  return {
    state,
    handlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    processFile,
    reset,
  };
}
