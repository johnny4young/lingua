/**
 * RL-099 Slice 5 — pipeline template gallery.
 *
 * Presentational grid of curated starter pipelines shown in the
 * pipeline panel's empty state (and via the list-header button — fold
 * B). Each card shows the template name, description, and the adapter
 * chain it runs (fold C), with a "Use template" button that hands the
 * template back to the panel to instantiate. All copy via `t()`;
 * token-only visuals.
 */

import { ArrowRight, Sparkles } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '../../../shared/utilities/registry';
import {
  PIPELINE_TEMPLATES,
  type PipelineTemplate,
} from '../../../shared/utilityPipelineTemplates';

export interface PipelineTemplateGalleryProps {
  /** Instantiate the chosen template into a new pipeline. */
  onUseTemplate: (template: PipelineTemplate) => void;
}

export function PipelineTemplateGallery({
  onUseTemplate,
}: PipelineTemplateGalleryProps) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="pipeline-template-gallery"
      className="flex flex-col gap-3"
      aria-label={t('utilityPipeline.template.galleryTitle')}
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg-base">
          <Sparkles size={14} aria-hidden="true" className="text-accent" />
          {t('utilityPipeline.template.galleryTitle')}
        </div>
        <p className="text-xs text-muted">
          {t('utilityPipeline.template.galleryBody')}
        </p>
      </header>
      <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PIPELINE_TEMPLATES.map((template) => (
          <li key={template.id}>
            <div
              data-testid="pipeline-template-card"
              data-template-id={template.id}
              className="flex h-full flex-col gap-2 rounded-md border border-border-subtle bg-bg-panel-alt p-3"
            >
              <div className="text-[13px] font-medium text-fg-base">
                {t(template.nameKey)}
              </div>
              <div className="flex-1 text-xs leading-relaxed text-muted">
                {t(template.descriptionKey)}
              </div>
              {/* Fold C — adapter chain preview so the card is self-
                  explanatory before the user commits. */}
              <div
                data-testid="pipeline-template-chain"
                className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-fg-subtle"
              >
                {template.steps.map((step, index) => {
                  const adapter = getAdapter(step.utilityId);
                  const label = adapter ? t(adapter.titleKey) : step.utilityId;
                  return (
                    <Fragment key={`${template.id}-${index}`}>
                      {index > 0 ? (
                        <ArrowRight size={9} aria-hidden="true" />
                      ) : null}
                      <span className="rounded-sm bg-bg-panel px-1.5 py-0.5">
                        {label}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => onUseTemplate(template)}
                data-testid="pipeline-template-use"
                data-template-id={template.id}
                className="button-secondary self-start text-xs"
              >
                {t('utilityPipeline.template.useButton')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
