import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindStopRunKey } from '@/components/Editor/stopRunKeybinding';
import { useResultStore } from '@/stores/resultStore';

const initialResult = useResultStore.getState();

afterEach(() => {
  useResultStore.setState(initialResult, true);
});

function fakeEditor() {
  const key = { set: vi.fn() };
  const action = { dispose: vi.fn() };
  const editor = { createContextKey: vi.fn(() => key), addAction: vi.fn(() => action) };
  const monaco = { KeyMod: { CtrlCmd: 2048 }, KeyCode: { Period: 89 } };
  return { editor, monaco, key, action };
}

describe('Cmd/Ctrl+. in the editor', () => {
  it('stops a manual run only while one is in flight, and unbinds on dispose', () => {
    const { editor, monaco, key, action } = fakeEditor();
    const cancel = vi.fn();
    const binding = bindStopRunKey(editor as never, monaco as never, 'Stop the run');
    const options = editor.addAction.mock.calls[0]![0] as { keybindings: number[]; precondition: string; run: () => void };
    expect(options.keybindings).toEqual([2048 | 89]);
    expect(editor.createContextKey).toHaveBeenCalledWith(options.precondition, false);

    useResultStore.setState({ isManualRunning: true, manualRunSession: { cancel } as never });
    expect(key.set).toHaveBeenLastCalledWith(true);
    options.run();
    expect(cancel).toHaveBeenCalledOnce();

    binding.dispose();
    expect(action.dispose).toHaveBeenCalledOnce();
    useResultStore.setState({ isManualRunning: false });
    expect(key.set).toHaveBeenCalledTimes(1);
  });
});
