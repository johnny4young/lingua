import { useTranslation } from 'react-i18next';
import type { HttpTransportKind } from '../../../shared/httpWorkspaceSchema';

interface HttpTransportSelectProps {
  value: HttpTransportKind;
  onChange: (transport: HttpTransportKind) => void;
}

export function HttpTransportSelect({ value, onChange }: HttpTransportSelectProps) {
  const { t } = useTranslation();
  return (
    <>
      <label className="sr-only" htmlFor="http-request-transport">
        {t('httpWorkspace.editor.transport.label')}
      </label>
      <select
        id="http-request-transport"
        data-testid="http-request-editor-transport"
        value={value}
        onChange={event => onChange(event.target.value as HttpTransportKind)}
        className="h-8 shrink-0 rounded-md border border-border bg-bg-panel px-2 text-body-sm font-semibold text-fg-base focus:border-border-strong focus:outline-none"
      >
        <option value="http">{t('httpWorkspace.editor.transport.http')}</option>
        <option value="sse">{t('httpWorkspace.editor.transport.sse')}</option>
        <option value="websocket">{t('httpWorkspace.editor.transport.websocket')}</option>
      </select>
    </>
  );
}
