import type { RichOutputPayload } from '../../../shared/richOutput';
import { typeIcon } from './richConsoleFormat';

interface RichValueObjectProps {
  payload: Extract<RichOutputPayload, { kind: 'object' }>;
}

/**
 * implementation — compact preview for `{ kind: 'object' }`. Echoes
 * the `<VariableInspectorPanel>` row's visual shape: type icon +
 * `Type{key1, key2, …}` preview clipped at three keys.
 */
export function RichValueObject({ payload }: RichValueObjectProps) {
  const keys = payload.entries.slice(0, 3).map((entry) => entry.key);
  const more = payload.entries.length > 3 ? ', …' : '';
  return (
    <span className="font-mono text-foreground">
      <span className="select-none text-fg-subtle">{typeIcon(payload)} </span>
      {payload.previewType}
      <span className="text-fg-subtle">{`{${keys.join(', ')}${more}}`}</span>
    </span>
  );
}
