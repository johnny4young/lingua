import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { DebuggerDrawerProps } from './DebuggerDrawer';
import { loadDebuggerDrawer } from './debuggerDrawerLoader';

/**
 * Startup-safe activation boundary for the Debugger tab: the panel, its
 * breakpoint and watch editors and their copy load only when the tab opens.
 */
export function DebuggerDrawerHost(props: DebuggerDrawerProps) {
  const { t } = useTranslation();
  const [Drawer, setDrawer] = useState<ComponentType<DebuggerDrawerProps> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDebuggerDrawer()
      .then(module => {
        if (active) setDrawer(() => module.DebuggerDrawer);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[debugger] failed to load the debugger panel', error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (Drawer) return <Drawer {...props} />;
  if (failed) {
    return (
      <p role="alert" data-testid="debugger-drawer-load-failed" className="px-4 py-3 text-body-sm text-fg-muted">
        {t('bottomPanel.debugger.loadFailed')}
      </p>
    );
  }
  return null;
}
