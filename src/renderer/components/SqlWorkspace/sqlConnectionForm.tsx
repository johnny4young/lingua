/** Form pieces the connection sheet and its sections share. */

import { cn } from '../../utils/cn';

export const LABEL = 'font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle';
export const INPUT = 'focus-ring mt-1 h-7 w-full rounded-md border border-border-default bg-bg-inset px-2 font-mono text-body-sm text-fg-base placeholder:text-fg-subtle';
export const BUTTON = 'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40';
export const PRIMARY = 'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md bg-accent px-3 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
  render,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  label: string;
  testId: string;
  render: (option: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-1 flex w-fit flex-wrap rounded-[7px] border border-border-subtle bg-bg-inset p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          data-testid={`${testId}-${option}`}
          onClick={() => onChange(option)}
          className={cn(
            'focus-ring h-6 rounded-[5px] px-2.5 text-caption transition-colors',
            value === option ? 'bg-bg-panel text-fg-base shadow-[0_1px_2px_rgba(0,0,0,0.35)]' : 'text-fg-muted hover:text-fg-base'
          )}
        >
          {render(option)}
        </button>
      ))}
    </div>
  );
}
