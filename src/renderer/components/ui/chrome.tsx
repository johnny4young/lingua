import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: 'neutral' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active = false, tone = 'neutral', className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'icon-button size-9',
        active && 'icon-button-active',
        tone === 'danger' && 'icon-button-danger',
        className
      )}
      {...props}
    />
  );
});

export function Kbd({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <kbd className={cn('kbd-shell', className)}>{children}</kbd>;
}

interface OverlayBackdropProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'center' | 'top';
  onClose?: () => void;
}

export function OverlayBackdrop({
  align = 'center',
  className,
  children,
  onClose,
  onClick,
  ...props
}: OverlayBackdropProps) {
  return (
    <div
      className={cn(
        'overlay-backdrop',
        align === 'center' ? 'items-center justify-center p-4 sm:p-6' : 'items-start justify-center px-4 pt-[min(12vh,6rem)] sm:px-6',
        className
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function OverlayCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('overlay-card', className)} {...props}>
      {children}
    </div>
  );
}
