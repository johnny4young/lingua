import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Eye, GripVertical, Minimize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDraggable } from '../../hooks/useDraggable';
import { cn } from '../../utils/cn';
import { EyebrowMono, MonoBadge, TypePill } from '../ui/primitives';
import type { ScopeValue } from '../../../shared/scopeSnapshot';

const SUPPORTED_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

function valueKind(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.type;
    case 'function':
      return 'function';
    case 'object':
      return value.previewType || 'object';
    case 'array':
      return 'array';
    case 'error':
      return 'error';
  }
}

function valuePreview(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr;
    case 'function':
      return value.name ? `ƒ ${value.name}` : 'ƒ';
    case 'object':
      return `${value.previewType}{${value.entries.length}}`;
    case 'array':
      return `[${value.length}]`;
    case 'error':
      return value.message;
  }
}

export function FloatingVariablesCard() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const setTabVariableInspectorEnabled = useEditorStore(
    (state) => state.setTabVariableInspectorEnabled,
  );
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);
  const variableInspectorSurface = useSettingsStore(
    (state) => state.variableInspectorSurface,
  );
  const variablesCardPosition = useUIStore((state) => state.variablesCardPosition);
  const setVariablesCardPosition = useUIStore((state) => state.setVariablesCardPosition);
  const variablesCardCollapsed = useUIStore((state) => state.variablesCardCollapsed);
  const toggleVariablesCardCollapsed = useUIStore((state) => state.toggleVariablesCardCollapsed);
  const floatingPositionsResetRevision = useUIStore(
    (state) => state.floatingPositionsResetRevision,
  );
  const wasDraggingRef = useRef(false);

  const enabled =
    variableInspectorSurface === 'floating' &&
    activeTab?.variableInspectorEnabled === true &&
    activeTab.runtimeMode !== 'node' &&
    SUPPORTED_LANGUAGES.has(activeTab.language) &&
    scopeSnapshot !== null &&
    scopeSnapshot.language === activeTab.language;

  // Default to right-aligned but below the action pill + panel chips
  // so the card doesn't overlap them on first mount. y=180 keeps the
  // card clear of: chrome (56) + action pill (44) + panel chips (36)
  // + ~44px breathing room.
  const defaultPosition = useMemo(() => {
    if (typeof window === 'undefined') return { x: 720, y: 196 };
    return {
      x: Math.max(24, window.innerWidth - 278),
      y: 196,
    };
  }, []);

  const { position, handleProps, isDragging } = useDraggable({
    storageKey: 'lingua-ui:variables-card-pos:v2',
    defaultPosition: variablesCardPosition ?? defaultPosition,
    size: variablesCardCollapsed ? { width: 168, height: 34 } : { width: 260, height: 330 },
    viewportMargin: 12,
    resetSignal: floatingPositionsResetRevision,
  });

  useEffect(() => {
    if (isDragging) {
      wasDraggingRef.current = true;
      return;
    }
    if (!wasDraggingRef.current) return;
    wasDraggingRef.current = false;
    setVariablesCardPosition(position);
  }, [isDragging, position, setVariablesCardPosition]);

  if (!enabled || !activeTab || !scopeSnapshot) return null;

  const container = typeof document !== 'undefined' ? document.body : null;
  if (!container) return null;

  const entries = scopeSnapshot.variables;
  const hiddenCount = Math.max(0, scopeSnapshot.truncatedCount ?? 0);

  return createPortal(
    <section
      data-testid="floating-variables-card"
      data-collapsed={variablesCardCollapsed ? 'true' : 'false'}
      className={cn(
        'floating-variables-card fixed',
        isDragging ? 'select-none' : '',
      )}
      style={{ left: position.x, top: position.y, zIndex: 35 }}
      aria-label={t('variableInspector.floating.title')}
    >
      <header className="floating-variables-card-header">
        <button
          type="button"
          aria-label={t('variableInspector.floating.dragHandle')}
          className="inline-flex h-6 w-5 items-center justify-center rounded-full text-fg-subtle hover:text-fg-base"
          {...handleProps}
        >
          <GripVertical size={12} aria-hidden />
        </button>
        <Eye size={12} aria-hidden className="text-accent-fg" />
        <EyebrowMono className="min-w-0 flex-1 truncate">
          {t('variableInspector.floating.title')}
        </EyebrowMono>
        <MonoBadge tone="accent">{scopeSnapshot.variables.length}</MonoBadge>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base"
          onClick={toggleVariablesCardCollapsed}
          aria-label={
            variablesCardCollapsed
              ? t('variableInspector.floating.expand')
              : t('variableInspector.floating.collapse')
          }
        >
          <Minimize2 size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base"
          onClick={() => setTabVariableInspectorEnabled(activeTab.id, false)}
          aria-label={t('variableInspector.floating.close')}
        >
          <X size={12} aria-hidden />
        </button>
      </header>

      {variablesCardCollapsed ? null : (
        <>
          <div className="floating-variables-card-body">
            {entries.length === 0 ? (
              <p className="px-1 py-4 text-center text-[12px] italic text-fg-muted">
                {t('variableInspector.panel.empty')}
              </p>
            ) : (
              entries.map((entry) => (
                <div key={entry.name} className="floating-variables-row">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[11.5px] font-semibold text-accent-fg">
                      {entry.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[15px] font-semibold text-fg-base">
                      {valuePreview(entry.value)}
                    </p>
                  </div>
                  <TypePill kind={valueKind(entry.value)} />
                </div>
              ))
            )}
          </div>
          <footer className="floating-variables-card-footer">
            <span>{t('variableInspector.floating.pinHint')}</span>
            {hiddenCount > 0 ? (
              <span>{t('variableInspector.floating.hiddenCount', { count: hiddenCount })}</span>
            ) : null}
          </footer>
        </>
      )}
    </section>,
    container,
  );
}
