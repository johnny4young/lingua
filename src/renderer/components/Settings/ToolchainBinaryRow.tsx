import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHOOSE_BINARY_ERROR_KEYS,
  NATIVE_TOOLCHAIN_COMMANDS,
  nativeToolchainLabel,
  pushRetrySuccess,
} from '../../runners/nativeToolchainGuidance';
import { useNativeToolchainStore } from '../../stores/nativeToolchainStore';
import { appPlatform } from '../../utils/appPlatform';
import type { NativeLanguageToolchain } from '../../utils/nativeLanguageToolchainStatus';
import { SpecRow } from '../ui/SpecRow';

/** Desktop Settings → Languages row: which Go or Rust binary Run uses, and the way back to PATH. */
export function ToolchainBinaryRow({ toolchain }: { toolchain: NativeLanguageToolchain }) {
  const { t } = useTranslation();
  const chosenPath = useNativeToolchainStore((state) => state[toolchain].chosenPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = appPlatform() === 'desktop';
  const label = nativeToolchainLabel(toolchain);

  useEffect(() => {
    if (desktop) void useNativeToolchainStore.getState().loadChoice(toolchain);
  }, [desktop, toolchain]);

  if (!desktop) return null;

  const settle = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      setError(await work());
    } finally {
      setBusy(false);
    }
  };
  const choose = () =>
    settle(async () => {
      const result = await useNativeToolchainStore.getState().choose(toolchain);
      if (result.status === 'canceled') return null;
      if (result.status === 'failed') return t('nativeToolchain.choose.failed');
      if (result.status === 'invalid') {
        return t(CHOOSE_BINARY_ERROR_KEYS[result.reason], { toolchain: label, command: NATIVE_TOOLCHAIN_COMMANDS[toolchain] });
      }
      pushRetrySuccess(label);
      return null;
    });
  const backToPath = () =>
    settle(async () => ((await useNativeToolchainStore.getState().clearChoice(toolchain)) ? null : t('settings.languages.binary.clearFailed')));

  return (
    <SpecRow
      label={t('settings.languages.binary.label', { toolchain: label })}
      description={
        <span className="block min-w-0">
          <span className="block truncate font-mono" data-testid={`settings-${toolchain}-binary-path`} title={chosenPath ?? undefined}>
            {chosenPath ?? t('settings.languages.binary.fromPath')}
          </span>
          {error ? (
            <span role="alert" className="block text-error-fg" data-testid={`settings-${toolchain}-binary-error`}>
              {error}
            </span>
          ) : null}
        </span>
      }
      control={
        <span className="flex shrink-0 gap-2">
          {chosenPath ? (
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void backToPath()} data-testid={`settings-${toolchain}-binary-use-path`}>
              {t('settings.languages.binary.usePath')}
            </button>
          ) : null}
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void choose()} data-testid={`settings-${toolchain}-binary-choose`}>
            {t('nativeToolchain.action.choose')}
          </button>
        </span>
      }
    />
  );
}
