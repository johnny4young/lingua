import { useTranslation } from 'react-i18next';
import { SettingsSection, SpecCard } from '../ui/SpecRow';
import { GoLanguageIntelligenceRow } from './GoLanguageIntelligenceRow';
import { LanguageSupportScorecard } from './LanguageSupportScorecard';
import { RubyRuntimeRow } from './RubyRuntimeRow';
import { RustLanguageIntelligenceRow } from './RustLanguageIntelligenceRow';

/**
 * implementation (post-review refactor) — dedicated Settings tab for
 * per-language configuration. Aggregates the at-a-glance capability
 * scorecard plus the existing per-language preference rows (Rust LSP
 * path, Go LSP path, Ruby runtime preference) that used to live
 * inline at the bottom of Settings → Editor. The split lets the
 * Editor tab stay focused on editor-shell concerns (theme, font,
 * timeouts, vim mode) and gives the language matrix its own
 * discoverable surface — Cmd+8 in Settings, plus the palette
 * `Show language support` command (implementation note) which emits the
 * `settings.navigate` command so this tab opens on demand.
 *
 * FASE 2a — rebuilt on the canonical Settings rhythm: the scorecard is
 * its own `SettingsSection`, and the per-language preference rows are
 * grouped into ONE `SpecCard` of divided `SpecRow`s. Rust/Go mount
 * conditionally (only when their LSP is unavailable/degraded); Ruby
 * always renders and is therefore the last visible row, so it carries
 * `last` to drop the card's final hairline regardless of how many of
 * the LSP rows are present.
 */
export function LanguagesSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-7">
      <LanguageSupportScorecard />
      <SettingsSection
        eyebrow={t('settings.languages.perLanguage.title')}
        description={t('settings.languages.perLanguage.description')}
      >
        <SpecCard>
          <RustLanguageIntelligenceRow />
          <GoLanguageIntelligenceRow />
          <RubyRuntimeRow last />
        </SpecCard>
      </SettingsSection>
    </div>
  );
}
