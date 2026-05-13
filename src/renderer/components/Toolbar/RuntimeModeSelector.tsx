import { ChevronDown, Cpu, Globe, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  RUNTIME_MODES,
  isRuntimeModeImplemented,
  languageHasRuntimeModes,
  type RuntimeMode,
} from '../../../shared/runtimeModes';
import { Tooltip } from '../ui/chrome';
import { cn } from '../../utils/cn';

/**
 * RL-019 Slice 1 — explicit per-tab JS/TS runtime mode selector.
 *
 * Renders only when the active tab is a JS/TS buffer. Three options:
 *   - Worker — Slice 1, enabled.
 *   - Node — Slice 2, disabled with tooltip.
 *   - Browser preview — Slice 3, disabled with tooltip.
 *
 * Behaviour:
 *   - Click an enabled option → calls `setTabRuntimeMode` which
 *     fires the `runtime.mode_changed` telemetry and (fold G)
 *     pushes a status-notice toast confirming the switch.
 *   - Click a disabled option → noop; the tooltip already explains
 *     when the mode lands.
 *   - Escape / outside click → closes the dropdown.
 */

const MODE_LABEL_KEY: Record<RuntimeMode, string> = {
  worker: 'runtimeMode.mode.worker',
  node: 'runtimeMode.mode.node',
  'browser-preview': 'runtimeMode.mode.browserPreview',
};

const MODE_HINT_KEY: Record<RuntimeMode, string> = {
  worker: 'runtimeMode.hint.worker',
  node: 'runtimeMode.hint.node.comingSoon',
  'browser-preview': 'runtimeMode.hint.browserPreview.comingSoon',
};

const MODE_ICON: Record<RuntimeMode, typeof Cpu> = {
  worker: Cpu,
  node: Layers,
  'browser-preview': Globe,
};

export function RuntimeModeSelector() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const setTabRuntimeMode = useEditorStore((state) => state.setTabRuntimeMode);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Hide the selector entirely when the active tab is not a JS/TS
  // buffer. The Toolbar already guards on this but the component
  // keeps a defensive check so a future call site cannot mount the
  // selector against a Python / Go / Rust tab.
  if (!activeTab || !languageHasRuntimeModes(activeTab.language)) {
    return null;
  }

  const currentMode: RuntimeMode = activeTab.runtimeMode ?? 'worker';
  const currentLabel = t(MODE_LABEL_KEY[currentMode]);

  return (
    <div ref={containerRef} className="relative shrink-0" data-testid="runtime-mode-selector">
      <Tooltip content={t('runtimeMode.menuTitle')}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          data-testid="runtime-mode-selector-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('runtimeMode.label')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-surface-strong/88 px-3 py-1.5 text-xs font-semibold tracking-[0.02em] text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="text-[0.7rem] uppercase tracking-[0.08em] text-muted">
            {t('runtimeMode.label')}
          </span>
          <span>{currentLabel}</span>
          <ChevronDown size={12} />
        </button>
      </Tooltip>
      {open ? (
        <div
          role="menu"
          aria-label={t('runtimeMode.label')}
          className="surface-panel-strong absolute right-0 top-[calc(100%+0.55rem)] z-20 w-72 p-1.5"
        >
          {RUNTIME_MODES.map((mode) => {
            const Icon = MODE_ICON[mode];
            const enabled = isRuntimeModeImplemented(mode);
            const selected = mode === currentMode;
            const labelKey = MODE_LABEL_KEY[mode];
            const hintKey = MODE_HINT_KEY[mode];
            return (
              <button
                key={mode}
                role="menuitem"
                type="button"
                onClick={() => {
                  if (!enabled) return;
                  setTabRuntimeMode(activeTab.id, mode);
                  setOpen(false);
                }}
                disabled={!enabled}
                data-testid={`runtime-mode-option-${mode}`}
                aria-disabled={!enabled}
                title={!enabled ? t(hintKey) : undefined}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  enabled
                    ? selected
                      ? 'bg-primary-soft text-primary'
                      : 'text-foreground hover:bg-surface-strong/78'
                    : 'cursor-not-allowed text-muted opacity-70'
                )}
              >
                <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block text-xs font-semibold">{t(labelKey)}</span>
                  <span className="mt-1 block text-[0.7rem] text-muted">
                    {t(hintKey)}
                  </span>
                </span>
                {selected ? (
                  <span className="status-pill border-primary/25 bg-transparent px-2 text-[0.65rem] text-primary">
                    {t('toolbar.newFile.current')}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
