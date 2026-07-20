/**
 * HTTP workspace usability upgrade — Auth sub-tab.
 *
 * A small auth panel: None | Bearer token | Basic user:pass | API key
 * header. On send the runtime injects the resolved header via
 * `buildAuthHeader` (Authorization: Bearer.. / Basic base64 / a custom
 * header). The injected header is always baseline-sensitive, so the
 * response/capsule redaction scrubs the echo.
 *
 * Token / password inputs use `type="password"` so they are masked in
 * the UI; the underlying value persists in the request store the same
 * way an explicit Authorization header row already does.
 */

import { useTranslation } from 'react-i18next';
import {
  DEFAULT_API_KEY_HEADER,
  type HttpAuthKind,
  type HttpRequestAuth,
} from '../../../shared/httpWorkspace';

const FIELD_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none';

export interface HttpAuthTabProps {
  auth: HttpRequestAuth | undefined;
  onChange: (auth: HttpRequestAuth) => void;
}

export function HttpAuthTab({ auth, onChange }: HttpAuthTabProps) {
  const { t } = useTranslation();
  const kind: HttpAuthKind = auth?.kind ?? 'none';

  return (
    <section data-testid="http-request-editor-auth" className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <span className="text-caption font-semibold text-fg-base">
          {t('httpWorkspace.editor.auth.label')}
        </span>
        <label className="internal" htmlFor="http-request-auth-kind">
          {t('httpWorkspace.editor.auth.kind.label')}
        </label>
        <select
          id="http-request-auth-kind"
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value as HttpAuthKind;
            onChange({ ...auth, kind: nextKind });
          }}
          data-testid="http-request-editor-auth-kind"
          className="h-6 rounded-md border border-border-subtle bg-bg-panel px-1.5 text-caption font-semibold text-fg-base focus:border-border-strong focus:outline-none"
        >
          <option value="none">{t('httpWorkspace.editor.auth.kind.none')}</option>
          <option value="bearer">
            {t('httpWorkspace.editor.auth.kind.bearer')}
          </option>
          <option value="basic">{t('httpWorkspace.editor.auth.kind.basic')}</option>
          <option value="apiKey">
            {t('httpWorkspace.editor.auth.kind.apiKey')}
          </option>
        </select>
      </header>

      {kind === 'none' ? (
        <p className="text-caption text-fg-subtle">
          {t('httpWorkspace.editor.auth.none.hint')}
        </p>
      ) : null}

      {kind === 'bearer' ? (
        <label className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-caption text-fg-subtle">
            {t('httpWorkspace.editor.auth.bearer.token')}
          </span>
          <input
            type="password"
            value={auth?.token ?? ''}
            onChange={(event) =>
              onChange({ ...auth, kind: 'bearer', token: event.target.value })
            }
            placeholder={t('httpWorkspace.editor.auth.bearer.placeholder')}
            aria-label={t('httpWorkspace.editor.auth.bearer.token')}
            data-testid="http-request-editor-auth-bearer-token"
            className={FIELD_CLASS}
          />
        </label>
      ) : null}

      {kind === 'basic' ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-caption text-fg-subtle">
              {t('httpWorkspace.editor.auth.basic.username')}
            </span>
            <input
              type="text"
              value={auth?.username ?? ''}
              onChange={(event) =>
                onChange({ ...auth, kind: 'basic', username: event.target.value })
              }
              placeholder={t('httpWorkspace.editor.auth.basic.username')}
              aria-label={t('httpWorkspace.editor.auth.basic.username')}
              data-testid="http-request-editor-auth-basic-username"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-caption text-fg-subtle">
              {t('httpWorkspace.editor.auth.basic.password')}
            </span>
            <input
              type="password"
              value={auth?.password ?? ''}
              onChange={(event) =>
                onChange({ ...auth, kind: 'basic', password: event.target.value })
              }
              placeholder={t('httpWorkspace.editor.auth.basic.password')}
              aria-label={t('httpWorkspace.editor.auth.basic.password')}
              data-testid="http-request-editor-auth-basic-password"
              className={FIELD_CLASS}
            />
          </label>
        </div>
      ) : null}

      {kind === 'apiKey' ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-caption text-fg-subtle">
              {t('httpWorkspace.editor.auth.apiKey.header')}
            </span>
            <input
              type="text"
              value={auth?.apiKeyHeader ?? ''}
              onChange={(event) =>
                onChange({ ...auth, kind: 'apiKey', apiKeyHeader: event.target.value })
              }
              placeholder={DEFAULT_API_KEY_HEADER}
              aria-label={t('httpWorkspace.editor.auth.apiKey.header')}
              data-testid="http-request-editor-auth-apikey-header"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-caption text-fg-subtle">
              {t('httpWorkspace.editor.auth.apiKey.value')}
            </span>
            <input
              type="password"
              value={auth?.apiKeyValue ?? ''}
              onChange={(event) =>
                onChange({ ...auth, kind: 'apiKey', apiKeyValue: event.target.value })
              }
              placeholder={t('httpWorkspace.editor.auth.apiKey.value')}
              aria-label={t('httpWorkspace.editor.auth.apiKey.value')}
              data-testid="http-request-editor-auth-apikey-value"
              className={FIELD_CLASS}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}
