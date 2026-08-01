/** Shared formatter result contract crossing main, web, preload, and renderer. */
type FormatUnavailableReason = 'binary-missing' | 'web-unavailable';

interface FormatUnavailable {
  available: false;
  reason: FormatUnavailableReason;
  error: string;
}

interface FormatSuccess {
  available: true;
  success: true;
  formatted: string;
}

interface FormatFailure {
  available: true;
  success: false;
  error: string;
}

export type FormatIpcResult = FormatUnavailable | FormatSuccess | FormatFailure;
