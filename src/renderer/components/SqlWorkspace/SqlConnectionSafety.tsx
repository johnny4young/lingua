import { useTranslation } from 'react-i18next';
import { Toggle } from '../Settings/shared';

export interface SqlSafetySwitches {
  readOnly: boolean;
  confirmWrites: boolean;
  allowPrivateHost: boolean;
}

interface Props {
  value: SqlSafetySwitches;
  onChange: (key: keyof SqlSafetySwitches) => void;
  /** Off where there is no host to allow or refuse: SQLite files, Neon, D1 and the browser. */
  network: boolean;
  /** The engine has no read-only session, so read-only runs proven reads only. */
  provenReads?: boolean;
}

/** Per-connection switches: read-only sessions, typed confirm for every write, private addresses. */
export function SqlConnectionSafety({ value, onChange, network, provenReads = false }: Props) {
  const { t } = useTranslation();
  const tiles: Array<{ key: keyof SqlSafetySwitches; title: string; hint: string }> = [
    { key: 'readOnly', title: t('sqlWorkspace.connection.readOnly'), hint: t(provenReads ? 'sqlWorkspace.connection.safety.readOnlyHintProven' : 'sqlWorkspace.connection.safety.readOnlyHint') },
    { key: 'confirmWrites', title: t('sqlWorkspace.connection.safety.confirmWrites'), hint: t('sqlWorkspace.connection.safety.confirmWritesHint') },
    ...(network ? [{ key: 'allowPrivateHost' as const, title: t('sqlWorkspace.connection.safety.allowPrivate'), hint: t('sqlWorkspace.connection.safety.allowPrivateHint') }] : []),
  ];
  return (
    <div data-testid="sql-connection-safety" className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
      {tiles.map((tile) => (
        <label key={tile.key} className="flex items-start gap-2 rounded-[10px] border border-border-subtle bg-bg-panel px-2.5 py-2">
          <Toggle value={value[tile.key]} onChange={() => onChange(tile.key)} aria-label={tile.title} data-testid={`sql-connection-safety-${tile.key}`} />
          <span className="min-w-0">
            <span className="block text-body-sm text-fg-base">{tile.title}</span>
            <span className="block text-caption leading-snug text-fg-muted">{tile.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
