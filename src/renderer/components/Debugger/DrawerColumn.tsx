import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/** One column of the Debugger tab: a tag-styled title, an optional action at the right, the rows. */
export function DrawerColumn({
  title,
  aside,
  testid,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  testid: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} className={cn('debugger-column', className)}>
      <div className="debugger-column-head">
        <h4 className="type-tag debugger-column-title">{title}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}
