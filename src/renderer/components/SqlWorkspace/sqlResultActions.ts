import { useUIStore } from '../../stores/uiStore';

export function copyToClipboard(
  text: string,
  successNotice: { messageKey: string; values?: Record<string, string | number> }
): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'sqlWorkspace.action.clipboardUnavailable',
    });
    return;
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'success',
        messageKey: successNotice.messageKey,
        values: successNotice.values,
      });
    })
    .catch(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.action.clipboardUnavailable',
      });
    });
}
