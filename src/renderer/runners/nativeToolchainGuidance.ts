import i18next from 'i18next';
import { useUIStore } from '../stores/uiStore';

export type NativeToolchain = 'go' | 'rust' | 'node' | 'ruby' | 'deno' | 'bun';

interface NativeToolchainSpec {
  label: string;
  docsPath: string;
}

const TOOLCHAIN_SPECS: Record<NativeToolchain, NativeToolchainSpec> = {
  go: { label: 'Go', docsPath: '/docs/getting-started' },
  rust: { label: 'Rust', docsPath: '/docs/getting-started' },
  node: { label: 'Node.js', docsPath: '/docs/getting-started' },
  ruby: { label: 'Ruby', docsPath: '/docs/getting-started' },
  deno: { label: 'Deno', docsPath: '/docs/getting-started' },
  bun: { label: 'Bun', docsPath: '/docs/getting-started' },
};

function desktopShell(): LinguaAPI | null {
  if (typeof window === 'undefined') return null;
  if (!window.lingua || window.lingua.platform === 'web') return null;
  return window.lingua;
}

function localizedDocsUrl(path: string): string {
  const language = i18next.resolvedLanguage ?? i18next.language;
  const localePrefix = language.toLowerCase().startsWith('es') ? '/es' : '';
  return `https://linguacode.dev${localePrefix}${path}`;
}

function pushRetrySuccess(toolchain: string): void {
  useUIStore.getState().pushStatusNotice({
    tone: 'success',
    messageKey: 'nativeToolchain.retry.detected',
    values: { toolchain },
  });
}

type RecoveryMessageKey =
  | 'nativeToolchain.missing.message'
  | 'nativeToolchain.retry.stillMissing'
  | 'nativeToolchain.retry.checkFailed';

type RetryDetection = () => Promise<boolean | 'check-failed'>;

function pushRecoveryNotice(
  spec: NativeToolchainSpec,
  shell: LinguaAPI,
  retryDetection: RetryDetection,
  messageKey: RecoveryMessageKey
): void {
  const { statusNotice, statusNoticeQueue } = useUIStore.getState();
  const alreadyShown = [statusNotice, ...statusNoticeQueue].some(
    notice =>
      (notice?.messageKey === 'nativeToolchain.missing.message' ||
        notice?.messageKey === 'nativeToolchain.retry.stillMissing' ||
        notice?.messageKey === 'nativeToolchain.retry.checkFailed') &&
      notice.values?.toolchain === spec.label
  );
  if (alreadyShown) return;

  useUIStore.getState().pushStatusNotice({
    tone: 'warning',
    // A blocking recovery surface: sticky, so later notices wait behind it,
    // and high priority keeps it ahead of them in the queue.
    priority: 'high',
    sticky: true,
    messageKey,
    values: { toolchain: spec.label },
    actions: [
      {
        labelKey: 'nativeToolchain.action.install',
        onClick: () => {
          void shell
            .openExternal(localizedDocsUrl(spec.docsPath))
            .then((opened) => {
              if (!opened) {
                useUIStore.getState().pushStatusNotice({
                  tone: 'error',
                  messageKey: 'nativeToolchain.install.openFailed',
                });
              }
            })
            .catch(() => {
              useUIStore.getState().pushStatusNotice({
                tone: 'error',
                messageKey: 'nativeToolchain.install.openFailed',
              });
            });
        },
      },
      {
        labelKey: 'nativeToolchain.action.retry',
        onClick: () => {
          void retryDetection()
            .then((result) => {
              if (result === true) {
                pushRetrySuccess(spec.label);
                return;
              }
              pushRecoveryNotice(
                spec,
                shell,
                retryDetection,
                result === 'check-failed'
                  ? 'nativeToolchain.retry.checkFailed'
                  : 'nativeToolchain.retry.stillMissing'
              );
            })
            .catch(() => {
              pushRecoveryNotice(
                spec,
                shell,
                retryDetection,
                'nativeToolchain.retry.checkFailed'
              );
            });
        },
      },
    ],
  });
}

/**
 * Surface one actionable recovery path when a desktop-native runtime is
 * missing. Web runners deliberately stay on their existing adapter copy: a
 * browser cannot install or re-probe a host toolchain.
 */
export function pushMissingNativeToolchainNotice(
  toolchain: NativeToolchain,
  retryDetection: RetryDetection
): void {
  const shell = desktopShell();
  if (!shell) return;

  const spec = TOOLCHAIN_SPECS[toolchain];
  pushRecoveryNotice(
    spec,
    shell,
    retryDetection,
    'nativeToolchain.missing.message'
  );
}
