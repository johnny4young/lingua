import { useTranslation } from 'react-i18next';
import { GoLanguageIntelligenceRow } from './GoLanguageIntelligenceRow';
import { LanguageSupportScorecard } from './LanguageSupportScorecard';
import { RubyRuntimeRow } from './RubyRuntimeRow';
import { RustLanguageIntelligenceRow } from './RustLanguageIntelligenceRow';
import { Section } from './shared';

/**
 * RL-095 Slice 1 (post-review refactor) — dedicated Settings tab for
 * per-language configuration. Aggregates the at-a-glance capability
 * scorecard plus the existing per-language preference rows (Rust LSP
 * path, Go LSP path, Ruby runtime preference) that used to live
 * inline at the bottom of Settings → Editor. The split lets the
 * Editor tab stay focused on editor-shell concerns (theme, font,
 * timeouts, vim mode) and gives the language matrix its own
 * discoverable surface — Cmd+8 in Settings, plus the palette
 * `Show language support` command (fold B) which dispatches the
 * `lingua-settings-navigate-tab` event so this tab opens on demand.
 */
export function LanguagesSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <LanguageSupportScorecard />
      <Section
        title={t('settings.languages.perLanguage.title')}
        description={t('settings.languages.perLanguage.description')}
      >
        <RustLanguageIntelligenceRow />
        <GoLanguageIntelligenceRow />
        <RubyRuntimeRow />
      </Section>
    </div>
  );
}
