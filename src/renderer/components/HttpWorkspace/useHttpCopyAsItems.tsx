import { Copy, FileCode2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HTTP_CODEGEN_LABELS, HTTP_CODEGEN_TARGETS, type HttpCodegenTarget } from '../../../shared/httpCodegen';
import { buildHttpJsTab } from '../../../shared/httpJsTab';
import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import '../../i18n/httpBuilderCatalog';
import type { CommandBarVerbItem } from '../Chrome/CommandBarSlot';

export type HttpCopyFormat = 'curl' | HttpCodegenTarget;

// Copy-as menu formats. Labels are library / tool names (cURL, fetch,
// axios, requests) — proper nouns, not translatable UI copy — so they
// live as constants rather than i18n keys.
const COPY_FORMATS: ReadonlyArray<{
  id: HttpCopyFormat;
  label: string;
}> = [
  { id: 'curl', label: 'cURL' },
  ...HTTP_CODEGEN_TARGETS.map(target => ({
    id: target,
    label: HTTP_CODEGEN_LABELS[target],
  })),
];

/** Copy-as entries for the Send split menu: cURL, code snippets (fetch / axios / Python), and Open as JS tab. */
export function useHttpCopyAsItems({
  disabled,
  onCopy,
  maskedRequest,
}: {
  disabled: boolean;
  onCopy: (format: HttpCopyFormat) => void;
  /** The draft with environment secrets left as `{{key}}`. */
  maskedRequest: () => HttpRequestV1;
}): CommandBarVerbItem[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const openAsTab = () => {
      const request = maskedRequest();
      // The name also seeds the save dialog, and bidi controls can disguise it.
      const name = request.name.replace(/[\\/\p{Cc}\p{Cf}]/gu, '_').trim();
      const { addTab } = useEditorStore.getState();
      addTab({
        ...createDefaultTab('javascript'),
        ...(name ? { name: `${name}.js` } : {}),
        content: buildHttpJsTab(request, {
          sensitiveHeaders: useSettingsStore.getState().sensitiveHttpHeaders,
          fillInComment: t('httpWorkspace.editor.openAsTabFillIn'),
        }),
        // A scratchpad would send the request while it opens.
        workflowMode: 'run',
        runtimeMode: 'worker',
      });
    };
    return [
      ...COPY_FORMATS.map(({ id, label }) => ({
        id,
        label: t('httpWorkspace.editor.copyAs.item', { format: label }),
        icon: <Copy size={13} aria-hidden />,
        disabled,
        testId: `http-request-editor-copy-${id}`,
        onSelect: () => onCopy(id),
      })),
      {
        id: 'open-tab',
        label: t('httpWorkspace.editor.openAsTab'),
        icon: <FileCode2 size={13} aria-hidden />,
        disabled,
        testId: 'http-request-editor-open-tab',
        onSelect: openAsTab,
      },
    ];
  }, [t, disabled, onCopy, maskedRequest]);
}
