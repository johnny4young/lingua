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
      fontLigatures: settings.fontLigatures,
      layoutPreset: settings.layoutPreset,
    });
    const serialized = serializeThemePreset(preset);

    const saveDialog = window.lingua?.fs?.saveDialog;
    const write = window.lingua?.fs?.write;
    if (!saveDialog || !write) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.bridgeMissing',
      });
      return;
    }

    try {
      const chosen = await saveDialog(DEFAULT_FILENAME);
      if (!chosen) return;
      await write(chosen, serialized);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'settings.themePreset.exported',
        values: { path: chosen },
      });
    } catch (error) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.writeFailed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleImport = async () => {
    const selectFile = window.lingua?.fs?.selectFile;
    const read = window.lingua?.fs?.read;
    if (!selectFile || !read) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'settings.themePreset.error.bridgeMissing',
      });
      return;
    }

    try {
      const filePath = await selectFile();
      if (!filePath) return;
      const raw = await read(filePath);
      const result = parseThemePreset(raw);

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
        fontLigatures: result.preset.typography.fontLigatures,
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
