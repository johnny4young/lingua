import { Download, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import {
  buildThemePreset,
  parseThemePreset,
  serializeThemePreset,
  type ParseThemePresetResult,
} from '../../utils/themePreset';
import { joinAbsolute } from '../../utils/filePath';
import { Row } from './shared';

const DEFAULT_FILENAME = 'lingua-theme.json';

function presetParseFailureKey(result: Extract<ParseThemePresetResult, { ok: false }>): string {
  switch (result.reason) {
    case 'invalid-json':
      return 'settings.themePreset.error.invalidJson';
    case 'unsupported-version':
      return 'settings.themePreset.error.unsupportedVersion';
    case 'invalid-shape':
    default:
      return 'settings.themePreset.error.invalidShape';
  }
}

export function ThemePresetControls() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const applyThemePreset = useSettingsStore((s) => s.applyThemePreset);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleExport = async () => {
    const preset = buildThemePreset({
      theme: settings.theme,
      editorTheme: settings.editorTheme,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      // Slice 2 — these fields stay in the preset schema for backward
      // compatibility with older exports, but are hardcoded to baseline
      // values (ligatures on, shell follows editor theme).
      fontLigatures: true,
      layoutPreset: settings.layoutPreset,
      syncShellWithEditorTheme: true,
    });
    const serialized = serializeThemePreset(preset);

    const saveDialog = window.lingua?.fs?.saveDialog;
    const write = window.lingua?.fs?.write;
    const revokeRoot = window.lingua?.fs?.revokeRoot;
    if (!saveDialog || !write) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.bridgeMissing',
      });
      return;
    }

    let mintedRootId: string | null = null;
    try {
      const chosen = await saveDialog(DEFAULT_FILENAME);
      if (chosen.canceled) return;
      mintedRootId = chosen.rootId;
      await write(chosen.rootId, chosen.fileRelativePath, serialized);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'settings.themePreset.exported',
        values: {
          path: joinAbsolute(chosen.rootPath, chosen.fileRelativePath),
        },
      });
    } catch (error) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.writeFailed',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // RL-077 — atomic IPC: the picker mints a capability tied to the
      // parent directory; we revoke it once the one-shot write finishes
      // so transient tokens for theme exports don't accumulate.
      if (mintedRootId && revokeRoot) {
        await revokeRoot(mintedRootId).catch(() => {});
      }
    }
  };

  const handleImport = async () => {
    const selectFile = window.lingua?.fs?.selectFile;
    const revokeRoot = window.lingua?.fs?.revokeRoot;
    if (!selectFile) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.bridgeMissing',
      });
      return;
    }

    let mintedRootId: string | null = null;
    try {
      const picked = await selectFile();
      if (picked.canceled) return;
      mintedRootId = picked.rootId;
      const result = parseThemePreset(picked.content);

      if (!result.ok) {
        pushStatusNotice({
          tone: 'error',
          messageKey: presetParseFailureKey(result),
          detail: result.message,
        });
        return;
      }

      applyThemePreset({
        theme: result.preset.appearance.theme,
        editorTheme: result.preset.appearance.editorTheme,
        fontFamily: result.preset.typography.fontFamily,
        fontSize: result.preset.typography.fontSize,
        // Slice 2 — `syncShellWithEditorTheme` / `fontLigatures` are
        // baseline ON; imported presets that carry them are ignored.
        layoutPreset: result.preset.layout.layoutPreset,
      });
      pushStatusNotice({
        tone: 'success',
        messageKey: 'settings.themePreset.imported',
      });
    } catch (error) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.readFailed',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (mintedRootId && revokeRoot) {
        await revokeRoot(mintedRootId).catch(() => {});
      }
    }
  };

  return (
    <Row
      label={t('settings.themePreset.label')}
      hint={t('settings.themePreset.hint')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="button-secondary inline-flex items-center gap-1.5"
          onClick={() => void handleExport()}
        >
          <Download size={14} />
          {t('settings.themePreset.export')}
        </button>
        <button
          type="button"
          className="button-secondary inline-flex items-center gap-1.5"
          onClick={() => void handleImport()}
        >
          <Upload size={14} />
          {t('settings.themePreset.import')}
        </button>
      </div>
    </Row>
  );
}
