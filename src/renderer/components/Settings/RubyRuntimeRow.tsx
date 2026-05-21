import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveUserEnvForRunner } from '../../runners/env';
import { Row, Select } from './shared';

/**
 * RL-042 Slice 6 — Settings → Languages row that lets the user pick
 * between the bundled `@ruby/wasm-wasi` worker and the host `ruby`
 * binary. Defaults to `auto`; web builds hide the `system` choice
 * because the desktop bridge is missing.
 *
 * The status line under the select calls `window.lingua.ruby.detect`
 * once on mount so the user sees the detected version (or the
 * "missing" copy) without needing to actually run Ruby first.
 */
type DetectState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'detected'; version: string; semver?: string }
  | { kind: 'missing' };

interface DesktopBridge {
  detect: (
    userEnv?: Record<string, string>,
    force?: boolean
  ) => Promise<RubyDetectResult>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (
    window as Window & { lingua?: { ruby?: DesktopBridge } }
  ).lingua?.ruby;
  return bridge ?? null;
}

export function RubyRuntimeRow() {
  const { t } = useTranslation();
  const preference = useSettingsStore((state) => state.rubyRuntimePreference);
  const setPreference = useSettingsStore(
    (state) => state.setRubyRuntimePreference
  );

  const [detect, setDetect] = useState<DetectState>(() =>
    getDesktopBridge() ? { kind: 'loading' } : { kind: 'unavailable' }
  );

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge
      .detect(resolveUserEnvForRunner())
      .then((result) => {
        if (cancelled) return;
        if (result.installed) {
          setDetect({
            kind: 'detected',
            version: result.version ?? 'ruby',
            ...(result.semver ? { semver: result.semver } : {}),
          });
        } else {
          setDetect({ kind: 'missing' });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDetect({ kind: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const status =
    detect.kind === 'unavailable'
      ? t('settings.editor.rubyRuntime.statusUnavailable')
      : detect.kind === 'loading'
        ? null
        : detect.kind === 'detected'
          ? t('settings.editor.rubyRuntime.statusDetected', {
              version: detect.semver ?? detect.version,
            })
          : t('settings.editor.rubyRuntime.statusMissing');

  const isWebBuild = detect.kind === 'unavailable';

  const onDocsClick = () => {
    const url = 'https://www.ruby-lang.org/en/documentation/';
    const bridge = (window as Window & { lingua?: { openExternal?: (u: string) => Promise<boolean> } })
      .lingua?.openExternal;
    if (bridge) {
      void bridge(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Row
      label={t('settings.editor.rubyRuntime.label')}
      hint={t('settings.editor.rubyRuntime.description')}
    >
      <div className="flex flex-col gap-1.5">
        <Select
          value={preference}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'auto' || next === 'system' || next === 'wasm') {
              setPreference(next);
            }
          }}
          aria-label={t('settings.editor.rubyRuntime.label')}
          data-testid="settings-ruby-runtime"
        >
          <option value="auto">{t('settings.editor.rubyRuntime.option.auto')}</option>
          <option value="system" disabled={isWebBuild}>
            {t('settings.editor.rubyRuntime.option.system')}
            {isWebBuild ? ` — ${t('settings.editor.rubyRuntime.statusUnavailable')}` : ''}
          </option>
          <option value="wasm">{t('settings.editor.rubyRuntime.option.wasm')}</option>
        </Select>
        {status ? (
          <p className="text-xs text-fg-subtle" data-testid="settings-ruby-runtime-status">
            {status}
          </p>
        ) : null}
        {/* RL-042 Slice 6 fold G — quick affordance to the upstream
            Ruby docs. Uses `window.lingua.openExternal` on desktop so
            the link opens in the user's browser instead of inside the
            Electron window. */}
        <button
          type="button"
          className="self-start text-xs text-accent hover:underline"
          onClick={onDocsClick}
          data-testid="settings-ruby-runtime-docs-link"
        >
          {t('settings.editor.rubyRuntime.docsLink')}
        </button>
      </div>
    </Row>
  );
}
