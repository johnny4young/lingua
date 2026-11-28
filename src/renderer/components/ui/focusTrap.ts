import type { KeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

/** Keeps Tab inside a modal root: wraps at either end and pulls focus back in from outside. */
export function trapTab(event: KeyboardEvent<HTMLElement>, root: HTMLElement): void {
  // A key from a dialog portaled above this one bubbles here through React; that layer owns its Tab.
  if (event.key !== 'Tab' || !(event.target instanceof Node) || !root.contains(event.target)) return;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  const edge = event.shiftKey ? first : last;
  if (!root.contains(active) || active === edge) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}

const returnTargets = new WeakMap<HTMLElement, HTMLElement | null>();

/** A trigger that sat in a modal since replaced (a loading shell) hands over to that modal's own trigger. */
function liveReturnTarget(previous: HTMLElement | null): HTMLElement | null {
  let target = previous;
  while (target && !document.contains(target)) {
    let owner = target.parentElement;
    while (owner && !returnTargets.has(owner)) owner = owner.parentElement;
    target = owner ? (returnTargets.get(owner) ?? null) : null;
  }
  return target;
}

/** Returns focus to the trigger when a modal closes, unless the modal already sent it elsewhere (the editor after an accept). */
export function restoreFocus(previous: HTMLElement | null, root: HTMLElement | null): void {
  if (root) returnTargets.set(root, previous);
  const active = document.activeElement;
  const movedOut = active !== null && active !== document.body && !root?.contains(active);
  const target = liveReturnTarget(previous);
  if (movedOut || !target) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    // Detached nodes during a strict-mode double mount reject focus().
  }
}
