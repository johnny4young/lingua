/**
 * RL-093 / T8 — Runtime chip + engine picker for the floating action
 * pill ("what engine": Worker / Node / Browser preview / Deno / Bun).
 * Only mounted for languages with runtime modes (JS/TS). Extracted
 * verbatim.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Globe, Package, Rabbit, Terminal, Zap } from 'lucide-react';
import type { RuntimeMode } from '../../../shared/runtimeModes';
import type { EditorState, FileTab, Language } from '../../types';
import { MonoBadge } from '../ui/primitives';
import type { ActionPillMenu, ActionPillMenuSetter } from './useFloatingActionPill';

interface RuntimeSegmentProps {
  openMenu: ActionPillMenu | null;
  setOpenMenu: ActionPillMenuSetter;
  runtimeChip: { icon: ReactNode; label: string };
  activeRuntimeMode: FileTab['runtimeMode'];
  language: Language;
  ensureTabForLanguage: (lang: Language) => FileTab;
  setTabRuntimeMode: EditorState['setTabRuntimeMode'];
}

export function FloatingActionPillRuntimeSegment({
  openMenu,
  setOpenMenu,
  runtimeChip,
  activeRuntimeMode,
  language,
  ensureTabForLanguage,
  setTabRuntimeMode,
}: RuntimeSegmentProps) {
  const { t } = useTranslation();
  const runtimeItems: Array<{
    k: RuntimeMode;
    icon: ReactNode;
    label: string;
    desc: string;
  }> = [
    {
      k: 'worker',
      icon: <Package size={13} />,
      label: 'Worker',
      desc: t('actionPill.mode.worker'),
    },
    {
      k: 'node',
      icon: <Terminal size={13} />,
      label: 'Node',
      desc: t('actionPill.mode.node'),
    },
    {
      k: 'browser-preview',
      icon: <Globe size={13} />,
      label: 'Browser preview',
      desc: t('actionPill.mode.browser'),
    },
    {
      k: 'deno',
      icon: <Zap size={13} />,
      label: 'Deno',
      desc: t('actionPill.mode.deno'),
    },
    {
      k: 'bun',
      icon: <Rabbit size={13} />,
      label: 'Bun',
      desc: t('actionPill.mode.bun'),
    },
  ];

  return (
    <>
      <div className="relative">
        <button
          type="button"
          className="action-pill-segment rounded-none"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'runtime'}
          onClick={() => setOpenMenu(openMenu === 'runtime' ? null : 'runtime')}
          data-testid="action-pill-runtime"
        >
          <span aria-hidden>{runtimeChip.icon}</span>
          <span>{runtimeChip.label}</span>
          <ChevronDown size={10} aria-hidden className="text-fg-subtle" />
        </button>
        {openMenu === 'runtime' ? (
          <div className="dropdown-rich absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[340px]" role="menu">
            {runtimeItems.map((item) => {
              const isActive = activeRuntimeMode === item.k;
              return (
                <button
                  key={item.k}
                  type="button"
                  role="menuitem"
                  className="dropdown-rich-row w-full"
                  data-testid={`action-pill-runtime-option-${item.k}`}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    setOpenMenu(null);
                    // RL-093 follow-up — when the user opens
                    // the Runtime picker without a tab, create
                    // one in the chip's current language and
                    // apply the chosen runtime to it. Avoids
                    // the silent no-op the empty state used to
                    // surface as "click no funciona".
                    const target = ensureTabForLanguage(language);
                    setTabRuntimeMode(target.id, item.k);
                  }}
                >
                  <span className="row-icon self-start mt-0.5">{item.icon}</span>
                  <span>
                    <span className="row-label block">{item.label}</span>
                    <span className="row-desc block">{item.desc}</span>
                  </span>
                  {isActive ? (
                    <MonoBadge tone="accent">{t('actionPill.badgeActive')}</MonoBadge>
                  ) : (
                    <span />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <span className="action-pill-divider" />
    </>
  );
}
