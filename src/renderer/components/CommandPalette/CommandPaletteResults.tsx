import { Code, FileCode, Zap } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  languageBadgeClass,
  languageShortLabel,
} from '../../utils/languageMeta';
import type { CommandCategory, CommandEntry } from './commandPaletteModel';

const CATEGORY_ICON: Record<CommandCategory, ReactNode> = {
  template: <FileCode size={13} className="shrink-0 text-primary" />,
  snippet: <Code size={13} className="shrink-0 text-info" />,
  action: <Zap size={13} className="shrink-0 text-warning" />,
};

interface CommandPaletteResultsProps {
  commands: CommandEntry[];
  query: string;
  selectedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onHoverIndex: (index: number) => void;
}

export function CommandPaletteResults({
  commands,
  query,
  selectedIndex,
  listRef,
  onHoverIndex,
}: CommandPaletteResultsProps) {
  const { t } = useTranslation();
  return (
    <div ref={listRef} className="max-h-[26rem] overflow-y-auto px-2 py-2">
      {commands.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          {t('commandPalette.results.empty', { query })}
        </p>
      ) : (
        commands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            onClick={command.action}
            onMouseEnter={() => onHoverIndex(index)}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
              index === selectedIndex ? 'bg-primary-soft' : 'hover:bg-surface-strong/68'
            }`}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-strong/82">
              {CATEGORY_ICON[command.category]}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {command.label}
              </span>
              <span className="truncate text-xs text-muted">{command.description}</span>
            </div>
            {command.language && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${languageBadgeClass(command.language)}`}
              >
                {languageShortLabel(command.language)}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
