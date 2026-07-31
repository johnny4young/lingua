import { useEffect, useState, type ComponentType } from 'react';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import {
  loadRunCapsuleExportButton,
  type RunCapsuleExportButtonProps,
} from './runCapsuleExportLoader';

type RunCapsuleExportButtonComponent = ComponentType<RunCapsuleExportButtonProps>;

/**
 * Activation boundary for result-header Run Capsule export.
 *
 * The history store remains eager because capture powers several workspace
 * features. The icon control and export pipeline load only after the first
 * capsule exists, so a fresh workspace does not pay for an unavailable action.
 */
export function RunCapsuleExportButtonHost() {
  const capsule = useExecutionHistoryStore(state => state.latestCapsule());
  const [Button, setButton] = useState<RunCapsuleExportButtonComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const { error: pushErrorNotice } = useStatusNotice();

  useEffect(() => {
    if (!capsule || Button || failed) return;
    let active = true;
    void loadRunCapsuleExportButton()
      .then(module => {
        if (!active) return;
        setButton(() => module.RunCapsuleExportButton);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[run-capsule] failed to load the export control', error);
        pushErrorNotice('results.actions.exportCapsule.loadFailed');
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Button, capsule, failed, pushErrorNotice]);

  return capsule && Button ? <Button capsule={capsule} /> : null;
}
