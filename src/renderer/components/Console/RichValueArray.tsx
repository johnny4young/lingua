import type { RichOutputPayload } from '../../../shared/richOutput';
import { previewSummary, typeIcon } from './richConsoleFormat';

interface RichValueArrayProps {
  payload: Extract<RichOutputPayload, { kind: 'array' }>;
}

/**
 * RL-044 Slice 1B — compact preview for `{ kind: 'array' }`. Mirrors
 * the `<VariableInspectorPanel>` chrome: type icon + `[a, b, c, …]`
 * with `previewSummary` clipping each cell to 24 chars.
 */
export function RichValueArray({ payload }: RichValueArrayProps) {
  const sample = payload.entries.slice(0, 3).map((entry) => previewSummary(entry.value));
  const more = payload.length > 3 ? ', …' : '';
  return (
    <span className="font-mono text-foreground">
      <span className="select-none text-fg-subtle">{typeIcon(payload)} </span>
      <span className="text-fg-subtle">{`[${sample.join(', ')}${more}] (${payload.length})`}</span>
    </span>
  );
}
