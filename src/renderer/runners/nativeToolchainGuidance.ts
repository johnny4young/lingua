import i18next from 'i18next';
import { useUIStore } from '../stores/uiStore';

export type NativeToolchain = 'go' | 'rust' | 'node' | 'ruby';

interface NativeToolchainSpec {
  label: string;
  docsPath: string;
}

const TOOLCHAIN_SPECS: Record<NativeToolchain, NativeToolchainSpec> = {
  go: { label: 'Go', docsPath: '/docs/getting-started' },
  rust: { label: 'Rust', docsPath: '/docs/getting-started' },
  node: { label: 'Node.js', docsPath: '/docs/getting-started' },
  ruby: { label: 'Ruby', docsPath: '/docs/getting-started' },
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
  | 'nativeToolchain.retry.stillMissing';

function pushRecoveryNotice(
  spec: NativeToolchainSpec,
  shell: LinguaAPI,
  retryDetection: () => Promise<boolean>,
  messageKey: RecoveryMessageKey
): void {
  const currentNotice = useUIStore.getState().statusNotice;
  if (
    (currentNotice?.messageKey === 'nativeToolchain.missing.message' ||
      currentNotice?.messageKey === 'nativeToolchain.retry.stillMissing') &&
    currentNotice.values?.toolchain === spec.label
  ) {
    return;
  }

  useUIStore.getState().pushStatusNotice({
    tone: 'warning',
    // Missing native execution is a blocking recovery surface. Match the
    // onboarding priority so a first-run toast cannot silently discard the
    // install/retry path; same-priority notices replace in arrival order.
    priority: 'high',
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
            .then((installed) => {
              if (installed) {
                pushRetrySuccess(spec.label);
                return;
              }
              pushRecoveryNotice(
                spec,
                shell,
                retryDetection,
                'nativeToolchain.retry.stillMissing'
              );
            })
            .catch(() => {
              pushRecoveryNotice(
                spec,
                shell,
                retryDetection,
                'nativeToolchain.retry.stillMissing'
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
  retryDetection: () => Promise<boolean>
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
