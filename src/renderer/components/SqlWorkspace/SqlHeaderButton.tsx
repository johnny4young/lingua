import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { IconButton } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';

interface SqlHeaderButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: LucideIcon;
  label: string;
  /** Accessible name and tooltip. */
  name: string;
  /** A glyph named by its tooltip, on a row too narrow for the label. */
  iconOnly: boolean;
}

/** A QUERY-row button: icon and label, or a bordered square glyph on a narrow row. */
export function SqlHeaderButton({ icon: Icon, label, name, iconOnly, ...rest }: SqlHeaderButtonProps) {
  if (iconOnly) {
    return (
      <IconButton
        tooltip={name}
        tooltipSide="bottom"
        className="shrink-0 rounded-md border-border-default bg-bg-panel text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
        {...rest}
      >
        <Icon size={ICON_GLYPH.md} aria-hidden="true" />
      </IconButton>
    );
  }
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40"
      {...rest}
    >
      <Icon size={11} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
