import { fireEvent, screen } from '@testing-library/react';

/** The rail opens on request and stays as left for the session, so click only when it is closed. */
export function showColumnRail(): void {
  const toggle = screen.getByTestId('sql-column-rail-toggle');
  if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
}
