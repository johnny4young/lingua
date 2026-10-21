import { Separator } from 'react-resizable-panels';

/**
 * Drag handle between resizable panes. The inner divider stays transparent so
 * neighbouring panes read as one canvas; the 3 px hit zone fades in on hover.
 */
export function ResizeHandle({
  orientation = 'vertical',
  disabled = false,
}: {
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
}) {
  const isVertical = orientation === 'vertical';
  return (
    <Separator
      disabled={disabled}
      className={`group relative flex items-center justify-center transition-colors ${disabled ? 'pointer-events-none ' : ''}${
        isVertical
          ? '-mx-1 w-3 cursor-col-resize hover:bg-accent/5'
          : '-my-1 h-3 cursor-row-resize hover:bg-accent/5'
      }`}
    >
      <div
        className={`rounded-full bg-transparent transition-colors group-hover:bg-border-strong ${
          isVertical ? 'h-[78%] w-px' : 'h-px w-[78%]'
        }`}
      />
    </Separator>
  );
}
