import { useTranslation } from 'react-i18next';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import type { LicenseTier } from '../../../shared/license';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';

/**
 * Small toolbar badge that shows the current license tier at a glance.
 * Reads through `useEffectiveTier` so a tampered or expired token collapses
 * to `free` (the same fallback the entitlement policy uses), never granting
 * paid styling silently. Purely a read-only surface — clicking routes the
 * user to the License settings section via the supplied handler.
 *
 * FASE 2b (MOV.05) — the hand-rolled `status-pill` span now wraps the
 * shared `<StatusBadge>` primitive: `free` → quiet outline, any paid
 * tier → slate accent ramp with a leading dot. The structural element
 * (span when read-only, button when `onClick` is supplied) keeps every
 * data-* hook, the tooltip, and the focus/hover affordances; StatusBadge
 * owns the chip chrome and tone tokens.
 */

function labelKeyForTier(tier: LicenseTier): string {
  if (tier === 'free') return 'license.badge.free';
  // Paid tiers all render as PRO in the toolbar. Settings/tooltips use
  // the current public labels while legacy tier ids remain token-compatible.
  return 'license.badge.pro';
}

function toneForTier(tier: LicenseTier): StatusBadgeTone {
  // `free` = quiet outline (matches the old muted look). Any paid tier
  // reads "active paid session" via the slate accent ramp.
  return tier === 'free' ? 'free' : 'pro';
}

function wrapperToneClasses(tier: LicenseTier): string {
  // Paid tiers keep the primary accent on the wrapper so the toolbar reads
  // "active paid session" and the clickable variant has a hover/focus
  // target; the nested StatusBadge supplies the chip tokens.
  return tier === 'free' ? 'text-fg-muted' : 'text-primary';
}

interface LicenseBadgeProps {
  onClick?: () => void;
}

export function LicenseBadge({ onClick }: LicenseBadgeProps) {
  const { t } = useTranslation();
  const tier = useEffectiveTier();
  const label = t(labelKeyForTier(tier));
  const title = t('license.badge.tooltip', { tier: t(`license.tier.${tier}`) });
  const tone = toneForTier(tier);
  const dataTestId = 'license-badge';

  const badge = (
    <StatusBadge tone={tone} dot={tier !== 'free'}>
      {label}
    </StatusBadge>
  );

  if (!onClick) {
    return (
      <span
        data-testid={dataTestId}
        data-license-tier={tier}
        title={title}
        className={`inline-flex shrink-0 ${wrapperToneClasses(tier)}`}
      >
        {badge}
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
      className={`inline-flex shrink-0 rounded-sm transition-colors ${wrapperToneClasses(tier)} hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
    >
      {badge}
    </button>
  );
}
