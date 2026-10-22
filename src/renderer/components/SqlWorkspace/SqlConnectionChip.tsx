import type { SqlConnectionDraft } from '../../../shared/sqlConnections';
import { cn } from '../../utils/cn';
import { CONNECTION_TONE, engineDetail, toneOf, type SqlConnectionTone } from './sqlConnectionStyle';

/** The environment dot, the name and a mono detail, as every connection row shows them. */
export function ChipContent({ tone, name, detail }: { tone: SqlConnectionTone; name: string; detail: string }) {
  return (
    <>
      <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0 rounded-full', CONNECTION_TONE[tone].dot)} />
      <span className="max-w-[12rem] truncate text-body-sm text-fg-base">{name}</span>
      <span className="truncate font-mono text-caption text-fg-muted">{detail}</span>
    </>
  );
}

/** A connection in its environment's colour. */
export function ConnectionChip({ connection, readOnlyLabel }: { connection: Pick<SqlConnectionDraft, 'name' | 'engine' | 'readOnly' | 'env'>; readOnlyLabel: string }) {
  const tone = toneOf(connection.env);
  return (
    <span className={cn('inline-flex h-[22px] min-w-0 items-center gap-[7px] rounded-[7px] border px-[7px]', CONNECTION_TONE[tone].chip)}>
      <ChipContent tone={tone} name={connection.name} detail={engineDetail(connection, readOnlyLabel)} />
    </span>
  );
}
