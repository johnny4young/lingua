import type * as monacoTypes from 'monaco-editor';
import type { PulseRailLine } from '../../utils/pulseRail';

/** One line's run-rail mark, shared by the run rail and the test answers. */
export function railDecoration(
  monaco: typeof monacoTypes,
  { line, state, slot }: PulseRailLine,
  travel: boolean,
  trailSlot: number | null
): monacoTypes.editor.IModelDeltaDecoration {
  const classes = ['lingua-rail', `lingua-rail--${state}`];
  if (travel && slot !== null) classes.push('lingua-rail--pass', `lingua-rail--slot-${slot}`);
  else if (trailSlot !== null) classes.push('lingua-rail--trail', `lingua-rail--slot-${trailSlot}`);
  const marked = state === 'running' || state === 'paused';
  return {
    range: new monaco.Range(line, 1, line, 1),
    options: {
      linesDecorationsClassName: classes.join(' '),
      ...(marked ? { lineNumberClassName: `lingua-rail-number--${state}` } : {}),
      // The step's tint runs under the numbers and the rail too.
      ...(state === 'running' ? { marginClassName: 'lingua-rail-band' } : {}),
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  };
}
