import { useEffect, useState, type ComponentType } from 'react';
import { useDebuggerStore } from '../../stores/debuggerStore';
import type { DebuggerStepHudProps } from './DebuggerStepHud';

type StepHudComponent = ComponentType<DebuggerStepHudProps>;

let hudPromise: Promise<{ DebuggerStepHud: StepHudComponent }> | null = null;

/** Loads the step HUD the first time execution pauses in this editor's tab. */
export function DebuggerStepHudHost(props: DebuggerStepHudProps) {
  const pausedHere = useDebuggerStore((state) => state.pausedFrame !== null && state.pausedFrame.tabId === props.tabId);
  const [Hud, setHud] = useState<StepHudComponent | null>(null);

  useEffect(() => {
    if (!pausedHere || Hud) return;
    let active = true;
    hudPromise ??= import('./DebuggerStepHud');
    void hudPromise
      .then((module) => {
        if (active) setHud(() => module.DebuggerStepHud);
      })
      .catch((error: unknown) => console.error('[debugger] failed to load the step controls', error));
    return () => {
      active = false;
    };
  }, [pausedHere, Hud]);

  return Hud ? <Hud {...props} /> : null;
}
