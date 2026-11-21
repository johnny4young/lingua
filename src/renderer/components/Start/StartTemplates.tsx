import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { BUILT_IN_TEMPLATES, resolveTemplateDescription, resolveTemplateFileStem, type Template } from '../../data/templates';
import type { Language } from '../../types/language';
import { extensionForLanguage, languageLabel } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { DottedLeader, LanguageSquare, SectionHeading } from './StartParts';
import { templateLanguages, templateRows } from './startModel';

const FILTER_LANGUAGES = templateLanguages(BUILT_IN_TEMPLATES);

function openTemplate(template: Template): void {
  const tab = createDefaultTab(template.language);
  useEditorStore.getState().addTab({
    ...tab,
    content: template.code,
    name: `${resolveTemplateFileStem(template)}.${extensionForLanguage(template.language)}`,
  });
}

/** The built-in templates as a contents list: one row per title, a badge per language. */
export function StartTemplates() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Language | null>(null);
  const rows = useMemo(() => templateRows(BUILT_IN_TEMPLATES, t, filter), [t, filter]);
  const filters: Array<{ value: Language | null; label: string }> = [
    { value: null, label: t('start.templates.all') },
    ...FILTER_LANGUAGES.map(language => ({ value: language, label: languageLabel(language) })),
  ];

  return (
    <section className="start-section" aria-labelledby="start-templates-title" data-testid="start-templates">
      <SectionHeading
        id="start-templates-title"
        title={t('start.templates.title')}
        detail={String(BUILT_IN_TEMPLATES.length)}
        action={
          <span role="group" aria-label={t('start.templates.filter')} className="flex flex-wrap justify-end gap-x-3 text-[12.5px]">
            {filters.map(option => {
              const active = option.value === filter;
              return (
                <button
                  key={option.value ?? 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(option.value)}
                  data-testid={`start-templates-filter-${option.value ?? 'all'}`}
                  className={cn(
                    'rounded-sm transition-colors focus-ring',
                    active ? 'font-semibold text-fg-base' : 'text-fg-muted hover:text-fg-base'
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </span>
        }
      />
      <ul className="start-templates-list start-rule" data-testid="start-templates-list">
        {rows.map(row => (
          <li key={row.label} className="start-template flex h-[34px] min-w-0 items-center whitespace-nowrap">
            <span className="min-w-0 truncate font-medium text-fg-base" title={resolveTemplateDescription(row.templates[0]!, t)}>
              {row.label}
            </span>
            <DottedLeader />
            <span className="flex shrink-0 gap-1">
              {row.templates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => openTemplate(template)}
                  aria-label={t('start.templates.open', { name: row.label, language: languageLabel(template.language) })}
                  data-testid={`start-template-${template.id}`}
                  className="focus-ring rounded-md"
                >
                  <LanguageSquare language={template.language} />
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
