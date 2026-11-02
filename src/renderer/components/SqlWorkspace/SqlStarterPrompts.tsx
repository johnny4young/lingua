import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NlToSqlTable } from '../../../shared/ai/nlToSql';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useAskSqlStore } from '../../stores/askSqlStore';

const TEXT_TYPE = /char|text|string|enum/iu;

/** Three questions for Ask AI, about the first table when there is one. */
function starterSqlPrompts(tables: ReadonlyArray<NlToSqlTable>, t: (key: string, options?: Record<string, string>) => string): string[] {
  const table = tables[0];
  if (!table) return [t('sqlWorkspace.starter.sampleUsers'), t('sqlWorkspace.starter.nextDays'), t('sqlWorkspace.starter.now')];
  const column = table.columns?.find(candidate => TEXT_TYPE.test(candidate.type))?.name;
  return [
    t('sqlWorkspace.starter.preview', { table: table.name }),
    column ? t('sqlWorkspace.starter.groupBy', { table: table.name, column }) : t('sqlWorkspace.starter.count', { table: table.name }),
    t('sqlWorkspace.starter.nulls', { table: table.name }),
  ];
}

/** Shown over an empty query: each prompt opens Ask AI with it typed in. Pro, like Ask AI. */
export function SqlStarterPrompts({ tables }: { tables: ReadonlyArray<NlToSqlTable> }) {
  const { t } = useTranslation();
  const entitled = useEntitlement('LOCAL_AI');
  if (!entitled) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-wrap justify-center gap-2 px-4" data-testid="sql-starter-prompts">
      {starterSqlPrompts(tables, t).map(prompt => (
        <button
          key={prompt}
          type="button"
          onClick={() => useAskSqlStore.getState().open(prompt)}
          className="focus-ring pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-panel-alt px-3 py-1.5 text-body-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base"
        >
          <Sparkles size={11} aria-hidden="true" className="text-accent-fg" />
          {prompt}
        </button>
      ))}
    </div>
  );
}
