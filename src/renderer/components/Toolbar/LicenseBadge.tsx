import { useTranslation } from 'react-i18next';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import type { LicenseTier } from '../../../shared/license';

/**
 * Small toolbar badge that shows the current license tier at a glance.
 * Reads through `useEffectiveTier` so a tampered or expired token collapses
 * to `free` (the same fallback the entitlement policy uses), never granting
 * paid styling silently. Purely a read-only surface — clicking routes the
 * user to the License settings section via the supplied handler.
 */

function labelKeyForTier(tier: LicenseTier): string {
  if (tier === 'free') return 'license.badge.free';
  // Pro, Pro Lifetime, and Team all render as PRO in the toolbar — the
  // full variant is visible in Settings. Keeping the toolbar pill terse
  // avoids truncation across locales.
  return 'license.badge.pro';
}

function toneClassesForTier(tier: LicenseTier): string {
  if (tier === 'free') {
    return 'border-border/80 bg-surface-strong/75 text-muted';
  }
  // Highlight paid tiers with the primary palette so the toolbar reads
  // "active paid session" at a glance without peeking at Settings.
  return 'border-primary/40 bg-primary/18 text-primary';
}

interface LicenseBadgeProps {
  onClick?: () => void;
}

export function LicenseBadge({ onClick }: LicenseBadgeProps) {
  const { t } = useTranslation();
  const tier = useEffectiveTier();
  const label = t(labelKeyForTier(tier));
  const title = t('license.badge.tooltip', { tier: t(`license.tier.${tier}`) });

  const classes = `status-pill shrink-0 ${toneClassesForTier(tier)}`;
  const dataTestId = 'license-badge';

  if (!onClick) {
    return (
      <span
        data-testid={dataTestId}
        data-license-tier={tier}
        title={title}
        className={classes}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      data-license-tier={tier}
      title={title}
      aria-label={title}
      className={`${classes} transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
    >
      {label}
    </button>
  );
}
