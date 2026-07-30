export const BOOT_PHASES = [
  'system-language',
  'i18n',
  'react-mount',
  'first-paint',
  'rehydration',
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

export const BOOT_DURATION_BUCKETS = [
  '<50ms',
  '50-249ms',
  '250-999ms',
  '1-4.9s',
  '5-29.9s',
  '>=30s',
] as const;

export type BootDurationBucket = (typeof BOOT_DURATION_BUCKETS)[number];

export function bucketBootDuration(ms: number): BootDurationBucket {
  if (ms < 50) return '<50ms';
  if (ms < 250) return '50-249ms';
  if (ms < 1_000) return '250-999ms';
  if (ms < 5_000) return '1-4.9s';
  if (ms < 30_000) return '5-29.9s';
  return '>=30s';
}
