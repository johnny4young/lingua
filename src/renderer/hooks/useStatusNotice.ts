import {
  pushErrorNotice,
  pushInfoNotice,
  pushSuccessNotice,
  pushWarningNotice,
  type PushStatusNotice,
} from '../utils/statusNotice';

export interface StatusNoticeApi {
  readonly info: PushStatusNotice;
  readonly success: PushStatusNotice;
  readonly warning: PushStatusNotice;
  readonly error: PushStatusNotice;
}

const STATUS_NOTICE_API: StatusNoticeApi = Object.freeze({
  info: pushInfoNotice,
  success: pushSuccessNotice,
  warning: pushWarningNotice,
  error: pushErrorNotice,
});

/**
 * Tone-safe status-notice actions for React consumers.
 *
 * The returned object and functions are module-stable, so callbacks may depend
 * on individual actions without acquiring a Zustand subscription or changing
 * identity on every render.
 */
export function useStatusNotice(): StatusNoticeApi {
  return STATUS_NOTICE_API;
}
