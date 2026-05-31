/**
 * RL-089 — Profile backup section. Lives under Settings → General.
 *
 * Two stacked rows:
 *
 *   - **Export** — single button. Builds a profile from the live
 *     stores and triggers a download via `URL.createObjectURL` +
 *     `<a download>` with a Windows-safe filename.
 *
 *   - **Import** — primary `<input type="file">` button; paste-textarea
 *     fallback inside a disclosure. Validate → dry-run summary → policy
 *     radio group → Apply. The `replace` policy gates behind a confirm
 *     modal (native dialog on desktop via `profile:confirm-replace`;
 *     web returns cancel and surfaces an explicit notice).
 *
 *   - **Tooltip** on the `merge` radio: settings are singletons, so
 *     `merge` collapses to `replace` for them — only list-shaped data
 *     differs.
 */

import { Download, FileUp, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getActiveAppLanguage } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import {
  parseAndValidateProfile,
  type LinguaProfile,
  type ProfileImportError,
  type ProfileImportPolicy,
} from '../../../shared/profile/profile';
import { buildProfile, downloadProfileFile } from '../../utils/profileExport';
import { applyProfile } from '../../utils/profileImport';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';

function errorKeyFor(error: ProfileImportError): string {
  switch (error.kind) {
    case 'invalid-json':
      return 'profile.import.error.invalid-json';
    case 'unsupported-version':
      return 'profile.import.error.unsupported-version';
    case 'invalid-shape':
      return 'profile.import.error.invalid-shape';
  }
}

function countSettings(profile: LinguaProfile): number {
  return Object.values(profile.data.settings).filter(
    (value) => value !== undefined
  ).length;
}

function countEnvVars(profile: LinguaProfile): number {
  const project = profile.data.envVars.project;
  return (
    Object.keys(profile.data.envVars.global).length +
    Object.values(project).reduce((sum, scope) => sum + Object.keys(scope).length, 0)
  );
}

interface ParsedProfileState {
  raw: string;
  profile: LinguaProfile;
}

export function ProfileSection() {
  const { t } = useTranslation();
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteToggleId = useId();
  const policyName = useId();

  const [pasted, setPasted] = useState<string>('');
  const [showPaste, setShowPaste] = useState<boolean>(false);
  const [parsed, setParsed] = useState<ParsedProfileState | null>(null);
  const [policy, setPolicy] = useState<ProfileImportPolicy>('merge');

  const handleExport = () => {
    downloadProfileFile(buildProfile());
    pushStatusNotice({
      tone: 'success',
      messageKey: 'profile.export.success',
    });
  };

  const handleParseRaw = (raw: string) => {
    const result = parseAndValidateProfile(raw);
    if (!result.ok) {
      setParsed(null);
      pushStatusNotice({
        tone: 'error',
        messageKey: errorKeyFor(result.error),
        values:
          result.error.kind === 'invalid-shape'
            ? { field: result.error.field }
            : undefined,
      });
      return;
    }
    setParsed({ raw, profile: result.profile });
  };

  const handleFileChange = async (file: File) => {
    const text = await file.text();
    handleParseRaw(text);
  };

  const handlePastePreview = () => {
    if (!pasted.trim()) return;
    handleParseRaw(pasted);
  };

  const handleApply = async () => {
    if (!parsed) return;
    if (policy === 'replace') {
      const counts: ProfileConfirmReplaceCounts = {
        snippets: parsed.profile.data.snippets.length,
        envVars: countEnvVars(parsed.profile),
      };
      const response = await window.lingua.profile.confirmReplace(
        counts,
        getActiveAppLanguage()
      );
      // 0 = Replace, 1 = Cancel (matches `app:confirm-close` convention).
      // Surface a notice so the user sees an explicit result instead
      // of a click that silently does nothing — important on web,
      // where the stub always returns 1 (no native dialog) and the
      // user otherwise has no feedback.
      if (response !== 0) {
        pushStatusNotice({
          tone: 'info',
          messageKey: 'profile.import.replaceCancelled',
        });
        return;
      }
    }

    applyProfile(parsed.profile, policy);
    pushStatusNotice({
      tone: 'success',
      messageKey: 'profile.import.success',
    });
    setParsed(null);
    setPasted('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const importControl = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFileChange(file);
        }}
        className="hidden"
        data-testid="profile-import-file"
        aria-label={t('profile.import.fileButton')}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="button-secondary"
        data-testid="profile-import-file-button"
      >
        <FileUp size={14} />
        <span>{t('profile.import.fileButton')}</span>
      </button>
      <button
        type="button"
        onClick={() => setShowPaste((value) => !value)}
        className="button-secondary"
        aria-expanded={showPaste}
        aria-controls={pasteToggleId}
        data-testid="profile-import-paste-toggle"
      >
        <span>{t('profile.import.pasteToggle')}</span>
      </button>
    </div>
  );

  return (
    <SettingsSection eyebrow={t('profile.title')} description={t('profile.description')}>
      <SpecCard>
        <SpecRow
          label={t('profile.export.button')}
          control={
            <button
              type="button"
              onClick={handleExport}
              className="button-primary"
              data-testid="profile-export-button"
            >
              <Download size={14} />
              <span>{t('profile.export.button')}</span>
            </button>
          }
        />
        <SpecRow
          label={t('profile.import.label')}
          control={importControl}
          last
        />
      </SpecCard>

      {showPaste ? (
        <div id={pasteToggleId} className="grid gap-2">
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={t('profile.import.placeholder')}
            rows={6}
            className="field-shell font-mono text-xs"
            data-testid="profile-import-textarea"
            aria-label={t('profile.import.placeholder')}
          />
          <div>
            <button
              type="button"
              onClick={handlePastePreview}
              className="button-secondary"
              disabled={!pasted.trim()}
              data-testid="profile-import-validate"
            >
              <span>{t('profile.import.validate')}</span>
            </button>
          </div>
        </div>
      ) : null}

      {parsed ? (
        <div
          data-testid="profile-import-dry-run"
          className="grid gap-2 rounded-lg border border-border-subtle bg-bg-inset px-[18px] py-3 text-xs leading-5 text-fg-muted"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-base">
            {t('profile.import.dryRun.title')}
          </p>
          <ul className="list-disc pl-4">
            <li>
              {t('profile.import.dryRun.snippets', {
                count: parsed.profile.data.snippets.length,
              })}
            </li>
            <li>
              {t('profile.import.dryRun.envVars', {
                count: countEnvVars(parsed.profile),
              })}
            </li>
            <li>
              {t('profile.import.dryRun.settingsCount', {
                count: countSettings(parsed.profile),
              })}
            </li>
          </ul>

          <fieldset className="grid gap-1.5">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-base">
              {t('profile.import.policy.label')}
            </legend>
            {(['replace', 'merge', 'preserve'] as const).map((option) => (
              <label
                key={option}
                className="flex items-start gap-2 text-fg-base"
              >
                <input
                  type="radio"
                  name={policyName}
                  value={option}
                  checked={policy === option}
                  onChange={() => setPolicy(option)}
                  className="mt-[3px]"
                  data-testid={`profile-import-policy-${option}`}
                />
                <span className="grid">
                  <span>{t(`profile.import.policy.${option}`)}</span>
                  {option === 'merge' ? (
                    <span className="text-[11px] text-fg-subtle">
                      {t('profile.import.policy.merge.hint')}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <button
              type="button"
              onClick={() => void handleApply()}
              className="button-primary"
              data-testid="profile-import-apply"
            >
              <Upload size={14} />
              <span>{t('profile.import.apply')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}
