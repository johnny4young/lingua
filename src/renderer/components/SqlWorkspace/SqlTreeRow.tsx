import type { ReactNode } from 'react';

interface TreeRowProps {
  depth: number;
  expanded?: boolean;
  onToggle?: () => void;
  label: ReactNode;
  trailing?: ReactNode;
  testId: string;
  nodeName?: string;
}

/** One expandable tree row (Local, schema, group). Leaves render their own markup. */
export function TreeRow({ depth, expanded, onToggle, label, trailing, testId, nodeName }: TreeRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-testid={testId}
      data-node-name={nodeName}
      style={{ paddingLeft: 8 + depth * 12 }}
      className="focus-ring flex h-5 w-full items-center gap-[5px] pr-2.5 text-left font-mono text-caption text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base"
    >
      <span aria-hidden="true" className="w-2 shrink-0 text-fg-subtle">
        {expanded ? '▾' : '▸'}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-[5px] truncate">{label}</span>
      {trailing}
    </button>
  );
}
