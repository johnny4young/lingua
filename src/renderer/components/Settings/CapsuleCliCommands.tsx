import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { writeToClipboard } from '../../utils/clipboard';
import { capsuleCliCommands } from '../../utils/exportCapsuleJson';

interface CapsuleCliCommandsProps {
  available: boolean;
  /** Name chosen in the desktop save dialog, when known. */
  savedFileName?: string;
}

/** Copying a command never invokes the CLI; replay remains a separate user action. */
export function CapsuleCliCommands({ available, savedFileName }: CapsuleCliCommandsProps) {
  const { t } = useTranslation();
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  const copyCommand = useCallback(async (command: string) => {
    const copied = await writeToClipboard(command);
    pushStatusNotice({
      tone: copied ? 'success' : 'warning',
      messageKey: copied
        ? 'settings.account.runCapsules.cli.commandCopied'
        : 'settings.account.runCapsules.cli.clipboardUnavailable',
    });
  }, [pushStatusNotice]);

  const cli = capsuleCliCommands(savedFileName);
  const commands = [
    {
      id: 'validate',
      label: t('settings.account.runCapsules.cli.validate'),
      command: cli.validate,
    },
    {
      id: 'replay',
      label: t('settings.account.runCapsules.cli.replay'),
      command: cli.replay,
    },
  ] as const;

  return (
    <details className="border-t border-border-subtle py-3" data-testid="capsule-cli-handoff">
      <summary
        className="cursor-pointer font-medium text-body text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        data-testid="capsule-cli-handoff-toggle"
      >
        {t('settings.account.runCapsules.cli.title')}
      </summary>
      <p className="mt-2 text-caption leading-relaxed text-fg-subtle">
        {t('settings.account.runCapsules.cli.intro', { filename: cli.fileName })}
      </p>
      <div className="mt-3 grid gap-3">
        {commands.map(({ id, label, command }) => (
          <div key={id} className="min-w-0 rounded-md border border-border-subtle bg-bg-base p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-medium text-fg-base">{label}</span>
              <button
                type="button"
                className="focus-ring shrink-0 rounded-md border border-border-default px-2 py-1 text-caption text-fg-base transition-colors hover:bg-bg-panel-alt disabled:opacity-50"
                disabled={!available}
                onClick={() => void copyCommand(command)}
                data-testid={`capsule-cli-copy-${id}`}
                aria-label={t('settings.account.runCapsules.cli.copyCommand', { action: label })}
              >
                {t('settings.account.runCapsules.cli.copy')}
              </button>
            </div>
            <code className="mt-1 block break-all font-mono text-caption text-fg-subtle" data-testid={`capsule-cli-command-${id}`}>
              {command}
            </code>
          </div>
        ))}
      </div>
    </details>
  );
}
