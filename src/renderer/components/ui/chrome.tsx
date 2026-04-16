import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from 'react';
import { cn } from '../../utils/cn';

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipPosition {
  top: number;
  left: number;
  side: TooltipSide;
  arrowOffset: number;
}

interface TooltipProps {
  content: string;
  children: ReactElement;
  side?: TooltipSide;
  disabled?: boolean;
}

function mergeDescribedBy(
  existing: unknown,
  nextId: string | undefined
) {
  if (!nextId) {
    return existing;
  }

  const current = typeof existing === 'string' ? existing.trim() : '';
  return current ? `${current} ${nextId}` : nextId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveTooltipPosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  preferredSide: TooltipSide
): TooltipPosition {
  const gap = 12;
  const viewportPadding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let side = preferredSide;

  if (preferredSide === 'top' && triggerRect.top < tooltipRect.height + gap + viewportPadding) {
    side = 'bottom';
  } else if (
    preferredSide === 'bottom' &&
    viewportHeight - triggerRect.bottom < tooltipRect.height + gap + viewportPadding
  ) {
    side = 'top';
  } else if (preferredSide === 'left' && triggerRect.left < tooltipRect.width + gap + viewportPadding) {
    side = 'right';
  } else if (
    preferredSide === 'right' &&
    viewportWidth - triggerRect.right < tooltipRect.width + gap + viewportPadding
  ) {
    side = 'left';
  }

  if (side === 'top' || side === 'bottom') {
    const unclampedLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const left = clamp(
      unclampedLeft,
      viewportPadding,
      viewportWidth - tooltipRect.width - viewportPadding
    );
    const top =
      side === 'top'
        ? triggerRect.top - tooltipRect.height - gap
        : triggerRect.bottom + gap;
    const arrowOffset = clamp(
      triggerRect.left + triggerRect.width / 2 - left,
      16,
      tooltipRect.width - 16
    );

    return {
      top: clamp(top, viewportPadding, viewportHeight - tooltipRect.height - viewportPadding),
      left,
      side,
      arrowOffset,
    };
  }

  const unclampedTop = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
  const top = clamp(
    unclampedTop,
    viewportPadding,
    viewportHeight - tooltipRect.height - viewportPadding
  );
  const left =
    side === 'left'
      ? triggerRect.left - tooltipRect.width - gap
      : triggerRect.right + gap;
  const arrowOffset = clamp(
    triggerRect.top + triggerRect.height / 2 - top,
    16,
    tooltipRect.height - 16
  );

  return {
    top,
    left: clamp(left, viewportPadding, viewportWidth - tooltipRect.width - viewportPadding),
    side,
    arrowOffset,
  };
}

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled = false,
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !tooltipRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current || !tooltipRef.current) {
        return;
      }

      setPosition(
        resolveTooltipPosition(
          triggerRef.current.getBoundingClientRect(),
          tooltipRef.current.getBoundingClientRect(),
          side
        )
      );
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, side]);

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
    }
  }, [isOpen]);

  if (!isValidElement(children)) {
    return children;
  }

  const childElement = children as ReactElement<Record<string, unknown>>;
  const child = cloneElement(childElement, {
    'aria-describedby': mergeDescribedBy(
      childElement.props['aria-describedby'],
      isOpen ? tooltipId : undefined
    ),
  });

  const style = position
    ? ({
        top: `${position.top}px`,
        left: `${position.left}px`,
        '--tooltip-arrow-offset': `${position.arrowOffset}px`,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onMouseLeave={() => setIsOpen(false)}
        onFocusCapture={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsOpen(false);
          }
        }}
      >
        {child}
      </span>
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              data-side={position?.side ?? side}
              className={cn('tooltip-content', position ? 'opacity-100' : 'opacity-0')}
              style={style}
            >
              <span className="tooltip-label">{content}</span>
              <span className="tooltip-arrow" aria-hidden="true" />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: 'neutral' | 'danger';
  tooltip?: string;
  tooltipSide?: TooltipSide;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active = false, tone = 'neutral', className, tooltip, tooltipSide = 'top', ...props },
  ref
) {
  const button = (
    <button
      ref={ref}
      className={cn(
        'icon-button size-9',
        active && 'icon-button-active',
        tone === 'danger' && 'icon-button-danger',
        className
      )}
      aria-label={props['aria-label'] ?? tooltip}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip content={tooltip} side={tooltipSide} disabled={props.disabled}>
      {button}
    </Tooltip>
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
