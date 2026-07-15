import { useUIStore, type StatusNotice, type StatusNoticeTone } from '../stores/uiStore';

export type StatusNoticeOptions = Omit<StatusNotice, 'id' | 'tone' | 'messageKey'>;

export type PushStatusNotice = (messageKey: string, options?: StatusNoticeOptions) => void;

function pushNotice(
  tone: StatusNoticeTone,
  messageKey: string,
  options?: StatusNoticeOptions
): void {
  useUIStore.getState().pushStatusNotice({
    ...options,
    tone,
    messageKey,
  });
}

export const pushInfoNotice: PushStatusNotice = (messageKey, options) => {
  pushNotice('info', messageKey, options);
};

export const pushSuccessNotice: PushStatusNotice = (messageKey, options) => {
  pushNotice('success', messageKey, options);
};

export const pushWarningNotice: PushStatusNotice = (messageKey, options) => {
  pushNotice('warning', messageKey, options);
};

export const pushErrorNotice: PushStatusNotice = (messageKey, options) => {
  pushNotice('error', messageKey, options);
};
