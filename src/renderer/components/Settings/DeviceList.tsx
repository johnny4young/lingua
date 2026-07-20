import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  LicenseServerDevice,
  LicenseServerDeviceLimit,
  LicenseServerDevicesBucket,
  LicenseServerSurface,
} from '../../services/licenseServer';
import { StatusBadge } from '../ui/StatusBadge';
import { cn } from '../../utils/cn';

export interface DeviceListProps {
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
  currentDeviceId: string;
  /**
   * Single device id whose remove request is in flight, or `null`. Used
   * to disable every Remove button in both buckets while one mutation is
   * pending — concurrent removes against `/licenses/devices/remove`
   * would race the cached bucket update.
   */
  pendingRemovalId: string | null;
  onRemove: (deviceId: string) => void;
}

const SURFACES: LicenseServerSurface[] = ['desktop', 'web'];

export function DeviceList({
  devices,
  deviceLimit,
  currentDeviceId,
  pendingRemovalId,
  onRemove,
}: DeviceListProps) {
  const { t, i18n } = useTranslation();
  return (
    <div data-testid="license-devices-list" className="grid w-full gap-3">
      {SURFACES.map((surface) => (
        <DeviceBucket
          key={surface}
          surface={surface}
          rows={devices[surface]}
          limit={deviceLimit[surface]}
          currentDeviceId={currentDeviceId}
          pendingRemovalId={pendingRemovalId}
          onRemove={onRemove}
          t={t}
          locale={i18n.language}
        />
      ))}
    </div>
  );
}

interface DeviceBucketProps {
  surface: LicenseServerSurface;
  rows: LicenseServerDevice[];
  limit: number;
  currentDeviceId: string;
  pendingRemovalId: string | null;
  onRemove: (deviceId: string) => void;
  t: TFunction;
  locale: string;
}

function DeviceBucket({
  surface,
  rows,
  limit,
  currentDeviceId,
  pendingRemovalId,
  onRemove,
  t,
  locale,
}: DeviceBucketProps) {
  const headingKey = `license.devices.surface.${surface}` as const;
  const emptyKey = `license.devices.empty.${surface}` as const;
  return (
    <div
      data-testid={`license-devices-bucket-${surface}`}
      className="rounded-md border border-border-subtle bg-bg-base px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-muted">
          {t(headingKey)}
        </span>
        <span
          data-testid={`license-devices-counter-${surface}`}
          className="font-mono text-caption text-fg-subtle"
        >
          {t('license.devices.counter', { count: rows.length, limit })}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-body-sm text-fg-subtle">{t(emptyKey)}</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {rows.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              surface={surface}
              isCurrent={device.deviceId === currentDeviceId}
              isPending={pendingRemovalId === device.deviceId}
              hasAnyPending={pendingRemovalId !== null}
              onRemove={onRemove}
              t={t}
              locale={locale}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface DeviceRowProps {
  device: LicenseServerDevice;
  surface: LicenseServerSurface;
  isCurrent: boolean;
  isPending: boolean;
  hasAnyPending: boolean;
  onRemove: (deviceId: string) => void;
  t: TFunction;
  locale: string;
}

function DeviceRow({
  device,
  surface,
  isCurrent,
  isPending,
  hasAnyPending,
  onRemove,
  t,
  locale,
}: DeviceRowProps) {
  const lastSeenRelative = formatRelativeTime(device.lastSeenAt, locale);
  return (
    <li
      data-testid={`license-device-row-${device.id}`}
      data-device-id={device.deviceId}
      data-current-device={isCurrent ? 'true' : undefined}
      className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-inset px-2.5 py-1.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body text-fg-base" title={device.deviceName}>
            {device.deviceName}
          </span>
          {isCurrent ? (
            <span data-testid="license-current-device-chip">
              <StatusBadge tone="info">{t('license.devices.currentChip')}</StatusBadge>
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-caption text-fg-subtle">
          <span>{device.os}</span>
          <span aria-hidden="true">·</span>
          <span>{t('license.devices.lastSeen', { relative: lastSeenRelative })}</span>
        </div>
      </div>
      <button
        type="button"
        data-testid={`license-device-remove-${device.id}`}
        onClick={() => onRemove(device.deviceId)}
        disabled={isCurrent || hasAnyPending}
        title={isCurrent ? t('license.devices.removeBlocked') : undefined}
        aria-label={
          isCurrent
            ? t('license.devices.removeBlocked')
            : t('license.devices.remove')
        }
        className={cn(
          'focus-ring shrink-0 rounded-md border border-border-default px-2 py-0.5 text-caption text-fg-muted transition-colors hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        {isPending ? t('license.devices.removing') : t('license.devices.remove')}
      </button>
      {/* Surface tag preserved for screen readers + e2e selectors. */}
      <span className="internal" data-testid={`license-device-surface-${device.id}`}>
        {surface}
      </span>
    </li>
  );
}

/**
 * Render `lastSeenAt` (Unix seconds — server stores it that way per
 * `licenses.devices.last_seen_at`) as a locale-aware relative string
 * via `Intl.RelativeTimeFormat`. Falls back to a localised short date
 * once the delta exceeds 30 days so the relative phrasing doesn't
 * stretch into "300 days ago" territory.
 *
 * `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat` are non-trivial
 * to construct (locale data lookup), so we cache one of each per
 * locale at module scope instead of re-instantiating on every row's
 * render. The cache is unbounded but keyed by locale tag — Lingua
 * ships two locales today, so the upper bound is two entries per
 * formatter type.
 */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getRelativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

function getDateFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

function formatRelativeTime(lastSeenAtSeconds: number, locale: string): string {
  const lastSeenMs = lastSeenAtSeconds * 1000;
  const delta = Date.now() - lastSeenMs;
  const sec = Math.round(delta / 1000);
  const min = Math.round(delta / 60_000);
  const hr = Math.round(delta / 3_600_000);
  const day = Math.round(delta / 86_400_000);
  const formatter = getRelativeFormatter(locale);
  if (sec < 60) return formatter.format(-sec, 'second');
  if (min < 60) return formatter.format(-min, 'minute');
  if (hr < 24) return formatter.format(-hr, 'hour');
  if (day < 30) return formatter.format(-day, 'day');
  return getDateFormatter(locale).format(new Date(lastSeenMs));
}
