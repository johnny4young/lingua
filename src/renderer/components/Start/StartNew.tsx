import { useEffect, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Database, FolderOpen, Globe, NotebookText, Package, Wrench } from 'lucide-react';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { NEW_SCRATCH_LANGUAGE } from '../../stores/editorTabUtils';
import { emitCommand } from '../../stores/commandBus';
import { useNativeToolchainStore } from '../../stores/nativeToolchainStore';
import { openHttpWorkspaceTab, openSqlWorkspaceTab, openUtilitiesWorkspaceTab } from '../../runtime/openWorkspaceTab';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import type { Language } from '../../types/language';
import { languageLabel } from '../../utils/languageMeta';
import { isNativeLanguageToolchain } from '../../utils/nativeLanguageToolchainStatus';
import { Kbd } from '../ui/chrome';
import { LanguageSquare, SectionHeading } from './StartParts';
import { START_LANGUAGES, isWebShell, languageAvailability, type LanguageAvailability } from './startModel';


function availabilityText(availability: LanguageAvailability, language: Language, t: TFunction) {
  switch (availability.kind) {
    case 'offline':
      return t('start.availability.offline');
    case 'browser':
      return t('start.availability.browser');
    case 'desktopOnly':
      return t('language.capability.desktopOnly');
    case 'toolchain':
      if (availability.status === 'installed') return t('start.availability.installed', { language: languageLabel(language) });
      if (availability.status === 'missing') return t('start.availability.missing');
      if (availability.status === 'check-failed') return t('start.availability.checkFailed');
      return t('start.availability.checking');
  }
}

function LanguageTile({ language, isWeb }: { language: Language; isWeb: boolean }) {
  const { t } = useTranslation();
  const status = useNativeToolchainStore(state => (isNativeLanguageToolchain(language) ? state[language].status : null));
  const availability = languageAvailability(language, isWeb, status);
  const text = availabilityText(availability, language, t);
  const warn = availability.kind === 'toolchain' && availability.status === 'missing';
  return (
    <button
      type="button"
      onClick={() => useEditorStore.getState().addTab(createDefaultTab(language))}
      aria-label={t('start.new.scratch', { language: languageLabel(language), availability: text })}
      data-testid={`start-new-${language}`}
      data-default={language === NEW_SCRATCH_LANGUAGE ? '' : undefined}
      className="start-tile focus-ring flex min-w-0 items-center rounded-[10px] border border-border-subtle text-left transition-colors hover:border-border-strong"
    >
      <LanguageSquare language={language} />
      <span className="min-w-0">
        <span className="start-tile-name block truncate font-semibold text-fg-base">{languageLabel(language)}</span>
        <span
          className="start-tile-sub block truncate"
          data-warn={warn ? '' : undefined}
          data-testid={`start-new-${language}-availability`}
        >
          {text}
        </span>
      </span>
    </button>
  );
}

function WorkspaceTile({ id, icon, label, shortcut, onOpen }: { id: string; icon: ReactNode; label: string; shortcut: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`start-workspace-${id}`}
      aria-keyshortcuts={shortcut ?? undefined}
      className="start-workspace flex h-[42px] min-w-0 items-center gap-2 rounded-[10px] border border-border-subtle px-2.5 text-left text-[12.5px] font-medium text-fg-base transition-colors hover:border-border-strong focus-ring"
    >
      <span className="shrink-0 text-fg-muted" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {shortcut ? <Kbd className="ml-auto">{shortcut}</Kbd> : null}
    </button>
  );
}

/** A scratch file in any language, or a whole workspace, each with how it runs here. */
export function StartNew() {
  const { t } = useTranslation();
  const isWeb = isWebShell();
  const notebookCombo = useShortcutLabel('action-new-notebook');
  const sqlCombo = useShortcutLabel('workspace-toggle-sql');
  const httpCombo = useShortcutLabel('workspace-toggle-http');
  const utilitiesCombo = useShortcutLabel('overlay-developer-utilities');
  const openCombo = useShortcutLabel('file-open');
  const capsulesCombo = useShortcutLabel('overlay-capsule-list');

  useEffect(() => {
    if (isWeb) return;
    const toolchains = useNativeToolchainStore.getState();
    void toolchains.probe('go');
    void toolchains.probe('rust');
  }, [isWeb]);

  const workspaces = [
    { id: 'notebook', icon: <NotebookText size={15} />, label: t('start.workspace.notebook'), shortcut: notebookCombo, onOpen: () => useEditorStore.getState().addNotebookTab() },
    { id: 'sql', icon: <Database size={15} />, label: t('start.workspace.sql'), shortcut: sqlCombo, onOpen: () => void openSqlWorkspaceTab() },
    { id: 'http', icon: <Globe size={15} />, label: t('start.workspace.http'), shortcut: httpCombo, onOpen: () => void openHttpWorkspaceTab() },
    { id: 'utilities', icon: <Wrench size={15} />, label: t('start.workspace.utilities'), shortcut: utilitiesCombo, onOpen: () => void openUtilitiesWorkspaceTab() },
    { id: 'open', icon: <FolderOpen size={15} />, label: t('start.workspace.open'), shortcut: openCombo, onOpen: () => void useEditorStore.getState().openFileFromDisk() },
    { id: 'capsules', icon: <Package size={15} />, label: t('start.workspace.capsules'), shortcut: capsulesCombo, onOpen: () => emitCommand('capsule.openList', { surface: 'shortcut' }) },
  ];

  return (
    <section className="start-section" aria-labelledby="start-new-title" data-testid="start-new">
      <SectionHeading id="start-new-title" title={t('start.new.title')} />
      <div className="start-languages">
        {START_LANGUAGES.map(language => (
          <LanguageTile key={language} language={language} isWeb={isWeb} />
        ))}
      </div>
      <div className="start-workspaces">
        {workspaces.map(workspace => (
          <WorkspaceTile key={workspace.id} {...workspace} />
        ))}
      </div>
    </section>
  );
}
