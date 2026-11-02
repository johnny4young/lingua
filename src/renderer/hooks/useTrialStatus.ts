import { useEffect, useState } from 'react';
import { trialDaysLeft, trialLengthDays } from '../../shared/plans';
import { useLicenseStore } from '../stores/licenseStore';
import { useEffectiveTier } from './useEntitlement';

const HOUR_MS = 3_600_000;

export interface TrialStatus {
  readonly daysLeft: number;
  readonly totalDays: number;
  /** Past the support window: still Pro during grace, but the trial is over. */
  readonly ended: boolean;
}

/** The verified trial's days, refreshed hourly so an open window does not show yesterday's count. */
export function useTrialStatus(): TrialStatus | null {
  const tier = useEffectiveTier();
  const status = useLicenseStore(state => state.status);
  const trial = tier === 'trial' && (status.kind === 'active' || status.kind === 'grace') ? status : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!trial) return;
    const timer = window.setInterval(() => setNow(Date.now()), HOUR_MS);
    return () => window.clearInterval(timer);
  }, [trial]);
  if (!trial) return null;
  const { issuedAt, supportWindowEndsAt } = trial.verification.payload;
  const daysLeft = trialDaysLeft(supportWindowEndsAt, now);
  return { daysLeft, totalDays: trialLengthDays(issuedAt, supportWindowEndsAt), ended: trial.kind === 'grace' || daysLeft === 0 };
}
