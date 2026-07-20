import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { typeIcon } from './richConsoleFormat';

interface RichValueMapSetProps {
  payload: Extract<RichOutputPayload, { kind: 'map' | 'set' }>;
}

/**
 * implementation — compact preview for `{ kind: 'map' | 'set' }`.
 * Echoes the `Map(N)` / `Set(N)` summary surface the inline pill
 * already emits (`formatPayloadInlineSummary`), with the type icon
 * promoted into the chrome.
 */
export function RichValueMapSet({ payload }: RichValueMapSetProps) {
  const { t } = useTranslation();
  const label =
    payload.kind === 'map'
      ? t('console.rich.mapSummary', { count: payload.size })
      : t('console.rich.setSummary', { count: payload.size });
  return (
    <span className="font-mono text-foreground">
      <span className="select-none text-fg-subtle">{typeIcon(payload)} </span>
      {label}
    </span>
  );
}
