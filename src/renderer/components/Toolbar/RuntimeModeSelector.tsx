import { ChevronDown, Cpu, Globe, Layers, Rabbit, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
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
 * Renders only when the active tab is a JS/TS buffer. Five options:
 *   - Worker — Slice 1, enabled.
 *   - Node — Slice 2, enabled in desktop.
 *   - Browser preview — Slice 3, enabled.
 *   - Deno — F-4, enabled in desktop when the binary is on PATH.
 *   - Bun — F-4, enabled in desktop when the binary is on PATH.
 *
 * Behaviour:
 *   - Click an enabled option → calls `setTabRuntimeMode` which
 *     fires the `runtime.mode_changed` telemetry and (fold G)
 *     pushes a status-notice toast confirming the switch.
 *   - Click a disabled option → noop; the tooltip explains why the
 *     mode is unavailable.
 *   - Escape / outside click → closes the dropdown.
 */

const MODE_LABEL_KEY: Record<RuntimeMode, string> = {
  worker: 'runtimeMode.mode.worker',
  node: 'runtimeMode.mode.node',
  'browser-preview': 'runtimeMode.mode.browserPreview',
  // F-4 — Deno / Bun desktop runtimes.
  deno: 'runtimeMode.mode.deno',
  bun: 'runtimeMode.mode.bun',
};

const MODE_HINT_KEY: Record<RuntimeMode, string> = {
  worker: 'runtimeMode.hint.worker',
  // RL-019 Slice 2 — node mode is shipping. Detector-failure path
  // (missing binary on PATH) surfaces a different copy via the
  // detection notice handled at the click site.
  node: 'runtimeMode.hint.node.ready',
  // RL-019 Slice 3 — browser-preview is implemented now; use the
  // shipping copy instead of the Slice 1 disabled-state hint.
  'browser-preview': 'runtimeMode.hint.browserPreview.shipping',
  // F-4 — Deno / Bun shipping; the binary-detection gate handles the
  // "not installed on PATH" path at the click site, same as node.
  deno: 'runtimeMode.hint.deno.ready',
  bun: 'runtimeMode.hint.bun.ready',
};

const MODE_ICON: Record<RuntimeMode, typeof Cpu> = {
  worker: Cpu,
  node: Layers,
  'browser-preview': Globe,
  deno: Zap,
  bun: Rabbit,
};

export function RuntimeModeSelector() {
  const { t } = useTranslation();
  const setTabRuntimeMode = useEditorStore((state) => state.setTabRuntimeMode);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeTab = useActiveTab();

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
  const CurrentIcon = MODE_ICON[currentMode];
  const compactTooltip = t('runtimeMode.compactTooltip', {
    label: t('runtimeMode.label'),
    mode: currentLabel,
  });

  return (
    <div ref={containerRef} className="relative shrink-0" data-testid="runtime-mode-selector">
      <Tooltip content={compactTooltip}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          data-testid="runtime-mode-selector-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={compactTooltip}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-inset px-3 py-[7px] text-body-sm font-medium tracking-[0.01em] text-fg-base transition-colors hover:bg-bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        >
          <CurrentIcon size={12} aria-hidden="true" className="text-fg-subtle" />
          <span>{currentLabel}</span>
          <ChevronDown size={11} className="text-fg-subtle" />
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
                  'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  enabled
                    ? selected
                      ? 'bg-bg-panel-alt font-semibold text-fg-base'
                      : 'text-fg-base hover:bg-bg-panel-alt'
                    : 'cursor-not-allowed text-fg-subtle opacity-70'
                )}
              >
                <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block text-body-sm font-semibold">{t(labelKey)}</span>
                  <span className="mt-1 block text-caption text-fg-subtle">
                    {t(hintKey)}
                  </span>
                </span>
                {selected ? (
                  <span className="status-pill border-border-subtle bg-transparent px-2 text-eyebrow text-fg-subtle">
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
