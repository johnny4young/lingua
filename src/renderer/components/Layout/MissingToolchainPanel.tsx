import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, FolderOpen, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ToolchainChooseResult } from '../../../shared/toolchainBinary';
import {
  nativeToolchainLabel,
  openInstallGuideFor,
  pushRetrySuccess,
} from '../../runners/nativeToolchainGuidance';
import { useNativeToolchainStore } from '../../stores/nativeToolchainStore';
import type { NativeLanguageToolchain } from '../../utils/nativeLanguageToolchainStatus';

const COMMANDS: Record<NativeLanguageToolchain, string> = { go: 'go', rust: 'rustc' };

const CHOOSE_ERROR_KEYS: Record<Extract<ToolchainChooseResult, { status: 'invalid' }>['reason'], string> = {
  'not-executable': 'nativeToolchain.choose.notExecutable',
  'wrong-name': 'nativeToolchain.choose.wrongName',
  blocked: 'nativeToolchain.choose.blocked',
  'check-failed': 'nativeToolchain.choose.checkFailed',
};

const BUTTON =
  'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2.5 text-caption font-medium disabled:opacity-50';

/** Dock state for a desktop Go or Rust tab whose binary was not found; editing stays open. */
export function MissingToolchainPanel({ toolchain }: { toolchain: NativeLanguageToolchain }) {
  return <MissingToolchainBody key={toolchain} toolchain={toolchain} />;
}

function MissingToolchainBody({ toolchain }: { toolchain: NativeLanguageToolchain }) {
  const { t } = useTranslation();
  const searched = useNativeToolchainStore(state => state[toolchain].searched);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const label = nativeToolchainLabel(toolchain);
  const command = COMMANDS[toolchain];

  async function settle(work: () => Promise<string | null>) {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback(await work());
    } finally {
      setBusy(false);
    }
  }

  const chooseBinary = () =>
    settle(async () => {
      const result = await useNativeToolchainStore.getState().choose(toolchain);
      if (result.status === 'canceled') return null;
      if (result.status === 'invalid') return t(CHOOSE_ERROR_KEYS[result.reason], { toolchain: label, command });
      pushRetrySuccess(label);
      return null;
    });

  const detectAgain = () =>
    settle(async () => {
      const status = await useNativeToolchainStore.getState().probe(toolchain, { refresh: true });
      if (status === 'installed') pushRetrySuccess(label);
      return status === 'missing' ? t('nativeToolchain.detect.stillMissing') : null;
    });

  return (
    <section
      data-testid="missing-toolchain-panel"
      data-toolchain={toolchain}
      aria-labelledby="missing-toolchain-title"
      className="shrink-0 border-b border-border-subtle px-4 py-3"
    >
      <h2 id="missing-toolchain-title" className="flex items-center gap-2 text-body font-semibold text-fg-base">
        <TriangleAlert size={16} className="shrink-0 text-warning-fg" aria-hidden="true" />
        {t('nativeToolchain.empty.title', { toolchain: label })}
      </h2>
      <p className="mt-1.5 max-w-[72ch] text-body-sm leading-relaxed text-fg-muted">
        {searched.length > 0
          ? t('nativeToolchain.empty.searched', { command, places: searched.join(', ') })
          : t('nativeToolchain.empty.searchedPath', { command })}{' '}
        {t('nativeToolchain.empty.keepEditing')}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openInstallGuideFor(toolchain)}
          className={`${BUTTON} border-accent bg-accent font-semibold text-fg-on-accent hover:bg-accent-hover`}
        >
          <BookOpen size={11} aria-hidden="true" />
          {t('nativeToolchain.action.install')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseBinary()}
          data-testid="missing-toolchain-choose"
          className={`${BUTTON} border-border-subtle bg-bg-panel text-fg-base hover:bg-bg-inset`}
        >
          <FolderOpen size={11} aria-hidden="true" />
          {t('nativeToolchain.action.choose')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void detectAgain()}
          data-testid="missing-toolchain-detect"
          className={`${BUTTON} border-border-subtle bg-bg-panel text-fg-base hover:bg-bg-inset`}
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          {t('nativeToolchain.action.detect')}
        </button>
      </div>
      <p role="status" data-testid="missing-toolchain-feedback" className="mt-2 text-caption text-warning-fg empty:hidden">
        {feedback}
      </p>
    </section>
  );
}
