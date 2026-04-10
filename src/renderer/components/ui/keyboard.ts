import type { KeyboardEvent } from 'react';

export function handleCloseOnEscape(
  event: KeyboardEvent<HTMLInputElement>,
  onClose: () => void
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
  }
}
