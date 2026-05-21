/**
 * RL-044 Slice 2b-β-α — `chart` payload renderer.
 *
 * Lazy-imports `vega-embed` on first mount; the resolved chunk lives
 * in its own Vite bundle (`vega-embed`) so the main entry stays
 * untouched until a chart payload actually renders.
 *
 * Theme awareness: reads `resolveEffectiveShellTheme` directly from
 * `useSettingsStore` (the `useAppTheme()` hook is side-effect only
 * and does not return the theme).
 *
 * Fold B (Pro-gated export): right-aligned actions menu offers
 * "Export as SVG" / "Export as PNG"; free-tier shows "Export (Pro)"
 * with `pushUpsellNotice` mirroring the `ConsoleEntryPopover`
 * Copy-as-JSON pattern.
 *
 * Failure modes:
 *   - `vegaEmbed` reject → text fallback chip (`chartLoadFailed` i18n).
 *   - Chunk load failure → text fallback chip (same path; the dynamic
 *     import promise rejects with a network error).
 *   - Spec validated upstream (`validateChartSpec`) so we trust the
 *     payload shape.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputChart } from '../../../shared/richOutput';
import { useSettingsStore } from '../../stores/settingsStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { resolveEffectiveShellTheme } from '../../hooks/useAppTheme';

interface RichValueChartProps {
  payload: RichOutputChart;
}

interface VegaResult {
  view: {
    toSVG: () => Promise<string>;
    toCanvas: () => Promise<HTMLCanvasElement>;
  };
  finalize: () => void;
}

type VegaEmbedFn = (
  el: HTMLElement,
  spec: unknown,
  opts: { theme?: 'dark' | null; actions?: boolean; renderer?: 'canvas' | 'svg' }
) => Promise<VegaResult>;

let vegaEmbedPromise: Promise<VegaEmbedFn> | null = null;
function loadVegaEmbed(): Promise<VegaEmbedFn> {
  if (vegaEmbedPromise) return vegaEmbedPromise;
  vegaEmbedPromise = import('vega-embed')
    .then((mod) => {
      const fn = (mod.default ?? mod) as unknown as VegaEmbedFn;
      return fn;
    })
    .catch((error: unknown) => {
      vegaEmbedPromise = null;
      throw error;
    });
  return vegaEmbedPromise;
}

export function RichValueChart({ payload }: RichValueChartProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const vegaResultRef = useRef<VegaResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [showMenu, setShowMenu] = useState(false);
  const canExportChart = useEntitlement('EXECUTION_HISTORY');

  // Read theme via the existing `resolveEffectiveShellTheme` helper.
  // `useAppTheme()` is side-effect-only (applies DOM class) and
  // returns void, so we re-derive here. The component re-mounts on
  // theme change because the selector subscriptions trigger render.
  const theme = useSettingsStore((s) => s.theme);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const syncShellWithEditorTheme = useSettingsStore(
    (s) => s.syncShellWithEditorTheme
  );
  const effectiveTheme = resolveEffectiveShellTheme(
    theme,
    editorTheme,
    syncShellWithEditorTheme
  );

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus('loading');

    loadVegaEmbed()
      .then((vegaEmbed) =>
        vegaEmbed(container, payload.spec, {
          theme: effectiveTheme === 'dark' ? 'dark' : null,
          actions: false,
          renderer: 'canvas',
        })
      )
      .then((result) => {
        if (cancelled) {
          result.finalize();
          return;
        }
        vegaResultRef.current = result;
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('failed');
      });

    return () => {
      cancelled = true;
      if (vegaResultRef.current) {
        vegaResultRef.current.finalize();
        vegaResultRef.current = null;
      }
    };
  }, [payload.spec, effectiveTheme]);

  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowMenu(false);
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setShowMenu(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [showMenu]);

  const handleExport = useCallback(
    async (format: 'svg' | 'png') => {
      if (!canExportChart) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: t('upsell.feature.chartExport'),
        });
        return;
      }
      const result = vegaResultRef.current;
      if (!result) return;
      try {
        if (format === 'svg') {
          const svg = await result.view.toSVG();
          downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'chart.svg');
        } else {
          const canvas = await result.view.toCanvas();
          canvas.toBlob((blob) => {
            if (blob) downloadBlob(blob, 'chart.png');
          }, 'image/png');
        }
      } catch {
        // Export failures are non-fatal; the chart stays rendered.
      } finally {
        setShowMenu(false);
      }
    },
    [canExportChart, t]
  );

  return (
    <span
      ref={rootRef}
      className="relative block w-full"
      data-testid="console-rich-chart"
      data-chart-status={status}
    >
      <span className="absolute left-0 top-0 z-10 flex items-center gap-1 px-1">
        {status === 'loading' && (
          <span className="rounded-md bg-bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
            {t('console.rich.chartLoading')}
          </span>
        )}
      </span>
      <span className="absolute right-0 top-0 z-10">
        <button
          type="button"
          onClick={() => setShowMenu((s) => !s)}
          aria-label={t('console.rich.chartActionsMenu')}
          aria-haspopup="menu"
          aria-expanded={showMenu}
          data-testid="console-rich-chart-actions"
          className="rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle hover:border-border/60 hover:text-foreground"
        >
          ⋯
        </button>
        {showMenu && (
          <span
            role="menu"
            className="absolute right-0 top-full mt-1 flex min-w-40 flex-col rounded-md border border-border/60 bg-bg-elevated p-1 text-[11px] shadow-md"
            data-testid="console-rich-chart-menu"
          >
            {canExportChart ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport('svg')}
                  className="block w-full px-2 py-1 text-left hover:bg-bg"
                >
                  {t('console.rich.chartExportSvg')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport('png')}
                  className="block w-full px-2 py-1 text-left hover:bg-bg"
                >
                  {t('console.rich.chartExportPng')}
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => handleExport('svg')}
                className="block w-full px-2 py-1 text-left text-fg-subtle hover:bg-bg"
                data-testid="console-rich-chart-export-pro"
              >
                {t('console.rich.chartExportPro')}
              </button>
            )}
          </span>
        )}
      </span>
      <span
        ref={containerRef}
        className="block w-full rounded-md border border-border/40 bg-bg p-2"
        style={{ minHeight: 200 }}
      />
      {status === 'failed' && (
        <span
          className="block rounded-md bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-fg-subtle"
          data-testid="console-rich-chart-failed"
        >
          {t('console.rich.chartLoadFailed')}
        </span>
      )}
    </span>
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
