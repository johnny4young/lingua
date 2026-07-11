import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { useUIStore } from '../../stores/uiStore';

export type ExportFormat = 'csv' | 'json' | 'markdown';

// Module-level so the JSX literal labels never trip the renderer-copy
// guard and the menu order stays a single source of truth.
export const EXPORT_FORMATS: ReadonlyArray<{ id: ExportFormat; labelKey: string }> = [
  { id: 'csv', labelKey: 'sqlWorkspace.action.exportAsCsv' },
  { id: 'json', labelKey: 'sqlWorkspace.action.exportAsJson' },
  { id: 'markdown', labelKey: 'sqlWorkspace.action.exportAsMarkdown' },
];

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
};

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  json: 'json',
  markdown: 'md',
};

export function buildExportFilename(format: ExportFormat): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `lingua-sql-${stamp}.${EXPORT_EXTENSIONS[format]}`;
}

const EXPORT_SUCCESS_KEYS: Record<ExportFormat, string> = {
  csv: 'sqlWorkspace.action.exportedCsv',
  json: 'sqlWorkspace.action.exportedJson',
  markdown: 'sqlWorkspace.action.exportedMarkdown',
};

const EXPORT_PREVIEW_SUCCESS_KEYS: Record<ExportFormat, string> = {
  csv: 'sqlWorkspace.action.exportedCsvPreview',
  json: 'sqlWorkspace.action.exportedJsonPreview',
  markdown: 'sqlWorkspace.action.exportedMarkdownPreview',
};

export function exportNoticeFor(
  response: SqlResponseV1,
  format: ExportFormat
): { messageKey: string; values?: Record<string, string | number> } {
  if (response.tooLarge) {
    return {
      messageKey: EXPORT_PREVIEW_SUCCESS_KEYS[format],
      values: {
        shown: response.rows.length,
        total: response.rowCount,
      },
    };
  }
  return { messageKey: EXPORT_SUCCESS_KEYS[format] };
}

type CopyFormat = 'csv' | 'json' | 'markdown';

const COPY_SUCCESS_KEYS: Record<CopyFormat, string> = {
  csv: 'sqlWorkspace.action.copiedCsv',
  json: 'sqlWorkspace.action.copiedJson',
  markdown: 'sqlWorkspace.action.copiedMarkdown',
};

const COPY_PREVIEW_SUCCESS_KEYS: Record<CopyFormat, string> = {
  csv: 'sqlWorkspace.action.copiedCsvPreview',
  json: 'sqlWorkspace.action.copiedJsonPreview',
  markdown: 'sqlWorkspace.action.copiedMarkdownPreview',
};

export function copyNoticeFor(
  response: SqlResponseV1,
  format: CopyFormat
): { messageKey: string; values?: Record<string, string | number> } {
  if (response.tooLarge) {
    return {
      messageKey: COPY_PREVIEW_SUCCESS_KEYS[format],
      values: {
        shown: response.rows.length,
        total: response.rowCount,
      },
    };
  }
  return {
    messageKey: COPY_SUCCESS_KEYS[format],
  };
}

export function copyToClipboard(
  text: string,
  successNotice: { messageKey: string; values?: Record<string, string | number> }
): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'sqlWorkspace.action.clipboardUnavailable',
    });
    return;
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'success',
        messageKey: successNotice.messageKey,
        values: successNotice.values,
      });
    })
    .catch(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.action.clipboardUnavailable',
      });
    });
}
