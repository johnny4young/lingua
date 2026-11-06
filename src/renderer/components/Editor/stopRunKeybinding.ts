import type * as monacoTypes from 'monaco-editor';
import { useResultStore } from '../../stores/resultStore';

/** Cmd/Ctrl+. stops a manual run from inside the editor; otherwise it stays Quick Fix. */
export function bindStopRunKey(
  editor: monacoTypes.editor.IStandaloneCodeEditor,
  monaco: typeof monacoTypes,
  label: string
): monacoTypes.IDisposable {
  const running = editor.createContextKey<boolean>('linguaManualRun', useResultStore.getState().isManualRunning);
  const unsubscribe = useResultStore.subscribe((state, previous) => {
    if (state.isManualRunning !== previous.isManualRunning) running.set(state.isManualRunning);
  });
  const action = editor.addAction({
    id: 'lingua.run.stop',
    label,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period],
    precondition: 'linguaManualRun',
    run: () => useResultStore.getState().manualRunSession?.cancel(),
  });
  return {
    dispose: () => {
      unsubscribe();
      action.dispose();
    },
  };
}
