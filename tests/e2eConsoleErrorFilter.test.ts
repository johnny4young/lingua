import { isKnownBenignConsoleError } from './e2e/consoleErrorFilter';

describe('isKnownBenignConsoleError', () => {
  it.each([
    '[E2E] intentional notebook workspace render crash',
    'Error: [E2E] intentional sql workspace render crash',
    'Error: [E2E] intentional utilities workspace render crash\n    at WorkspaceErrorBoundary',
    '%o\n\n%s\n\n%s\n Error: [E2E] intentional http workspace render crash\n    at WorkspaceErrorBoundary',
  ])('accepts an exact build-gated workspace crash probe: %s', message => {
    expect(isKnownBenignConsoleError(message)).toBe(true);
  });

  it.each([
    'Unexpected prefix [E2E] intentional notebook workspace render crash',
    'Error: wrapper: [E2E] intentional http workspace render crash',
    '[E2E] intentional settings workspace render crash',
  ])('does not hide a different error containing probe-like text: %s', message => {
    expect(isKnownBenignConsoleError(message)).toBe(false);
  });
});
