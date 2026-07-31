import { useEffect, useState, type ComponentType } from 'react';
import { useStatusNotice } from '../../hooks/useStatusNotice';
import {
  loadInlineResultWidgets,
  type InlineResultWidgetsProps,
} from './inlineResultWidgetsLoader';

type InlineResultWidgetsComponent = ComponentType<InlineResultWidgetsProps>;

/**
 * Startup-safe activation boundary for Monaco inline result overlays.
 *
 * Diagnostics remain eager. The overlay DOM, timing chips, and rich-output
 * summaries load only once a run produces something that can be displayed.
 */
export function InlineResultWidgetsHost(props: InlineResultWidgetsProps) {
  const enabled = props.lineResults.length > 0 || (props.lineTimings?.length ?? 0) > 0;
  const [Widgets, setWidgets] = useState<InlineResultWidgetsComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const { error: pushErrorNotice } = useStatusNotice();

  useEffect(() => {
    if (!enabled || Widgets || failed) return;
    let active = true;
    void loadInlineResultWidgets()
      .then(module => {
        if (!active) return;
        setWidgets(() => module.InlineResultWidgets);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[inline-results] failed to load the Monaco overlay', error);
        pushErrorNotice('results.inline.loadFailed');
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Widgets, enabled, failed, pushErrorNotice]);

  return enabled && Widgets ? <Widgets {...props} /> : null;
}
