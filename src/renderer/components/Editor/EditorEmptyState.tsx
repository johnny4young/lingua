import { useTranslation } from 'react-i18next';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import {
  BUILT_IN_TEMPLATES,
  resolveTemplateDescription,
  resolveTemplateFileStem,
  resolveTemplateLabel,
} from '../../data/templates';
import type { Language } from '../../types';
import {
  extensionForLanguage,
  languageBadgeClass,
  languageCapabilityBadgeKey,
  languageLabel,
} from '../../utils/languageMeta';
import { Kbd } from '../ui/chrome';

// RL-038 Slice C closeout — the quick-start row used to be a hardcoded
// `['javascript', 'typescript', 'go', 'python', 'rust']`. Walking
// `LANGUAGE_PACKS` with the runnable + has-templates predicate keeps
// the list in sync with the registry: future runnable packs that ship
// with starter templates land here automatically; Lua stays out until
// it gains a starter (its `templateIds` is empty per the Slice A
// guard test).
const QUICK_START_PACKS = LANGUAGE_PACKS.filter(
  (pack) =>
    (pack.execution === 'run' || pack.execution === 'compile') &&
    pack.templateIds.length > 0
);

const FEATURED_TEMPLATES = BUILT_IN_TEMPLATES.slice(0, 6);
const TOTAL_TEMPLATE_COUNT = BUILT_IN_TEMPLATES.length;

export function EditorEmptyState() {
  const { addTab } = useEditorStore();
  const { t } = useTranslation();
  // Mirror the platform-gate idiom used elsewhere (Toolbar, FileTree).
  // The "Desktop only" pill only makes sense on the web build —
  // packaged Electron actually runs Go / Rust, so a pill there would
  // mislead the user.
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';

  const openTemplate = (templateId: string) => {
    const template = BUILT_IN_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const tab = createDefaultTab(template.language);
    addTab({
      ...tab,
      content: template.code,
      name: `${resolveTemplateFileStem(template)}.${extensionForLanguage(template.language)}`,
    });
  };

  const quickStart = (language: Language) => {
    addTab(createDefaultTab(language));
  };

  return (
    <div className="relative flex h-full flex-col overflow-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top,rgba(144,103,255,0.18),transparent_68%)]" />

      <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col justify-center gap-8 px-5 py-8 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
        <section className="animate-rise-in space-y-7">
          <div className="inline-flex items-center gap-3">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-border-strong/80 bg-surface-strong/90 shadow-[0_18px_60px_rgba(12,14,24,0.18)]">
              <span className="font-display text-xl font-semibold tracking-[0.14em] text-primary">
                RL
              </span>
              <span className="absolute inset-1 rounded-[1.1rem] border border-white/6" />
            </div>
            <div>
              <p className="panel-title">{t('emptyState.brandLabel')}</p>
              <h1 className="font-display text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
                Lingua
              </h1>
            </div>
          </div>

          <div className="max-w-2xl space-y-3">
            <p className="max-w-xl text-balance font-display text-[1.95rem] font-semibold leading-tight tracking-[-0.04em] text-foreground sm:text-[2.45rem]">
              {t('emptyState.headline')}
            </p>
            <p className="max-w-xl text-sm leading-7 text-muted sm:text-base">
              {t('emptyState.description')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_START_PACKS.map((pack) => {
              const language = pack.id as Language;
              const isDesktopOnly =
                languageCapabilityBadgeKey(language) ===
                'language.capability.desktopOnly';
              const showDesktopOnlyBadge = isWebBuild && isDesktopOnly;
              return (
                <button
                  key={language}
                  type="button"
                  onClick={() => quickStart(language)}
                  data-testid={`empty-state-quick-start-${language}`}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5 ${languageBadgeClass(language)}`}
                >
                  <span>{languageLabel(language)}</span>
                  {showDesktopOnlyBadge ? (
                    <span
                      data-testid={`empty-state-desktop-only-${language}`}
                      className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted"
                    >
                      {t('language.capability.desktopOnly')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
            <span>
              <Kbd>Cmd+Shift+P</Kbd> {t('emptyState.shortcut.commands')}
            </span>
            <span>
              <Kbd>Cmd+B</Kbd> {t('emptyState.shortcut.sidebar')}
            </span>
            <span>
              <Kbd>Cmd+Enter</Kbd> {t('emptyState.shortcut.run')}
            </span>
          </div>
        </section>

        <section className="surface-panel-strong animate-rise-in overflow-hidden">
          <div className="surface-header flex items-center justify-between px-5 py-4">
            <div>
              <p className="panel-title">{t('emptyState.startingPoints.title')}</p>
              <p className="mt-1 text-sm text-muted">
                {t('emptyState.startingPoints.description')}
              </p>
            </div>
            <div className="status-pill">
              {t('emptyState.templatesCount', { count: TOTAL_TEMPLATE_COUNT })}
            </div>
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {FEATURED_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => openTemplate(template.id)}
                className="group flex flex-col gap-2 rounded-[1.35rem] border border-border/80 bg-background-elevated/74 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border-strong/90 hover:bg-background-elevated"
              >
                <span
                  className={`self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${languageBadgeClass(template.language)}`}
                >
                  {template.language}
                </span>
                <span className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">
                  {resolveTemplateLabel(template, t)}
                </span>
                <span className="text-xs leading-6 text-muted">
                  {resolveTemplateDescription(template, t)}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
