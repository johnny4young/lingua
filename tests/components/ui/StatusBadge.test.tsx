import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../../../src/renderer/components/ui/StatusBadge';

describe('StatusBadge sizing', () => {
  it('keeps its intrinsic width by default', () => {
    render(<StatusBadge tone="neutral">Open</StatusBadge>);
    expect(screen.getByText('Open').className).not.toContain('min-w-0');
  });

  it('can shrink inside a flex row when the caller truncates the label', () => {
    render(
      <StatusBadge tone="error" shrink>
        503 Service Unavailable
      </StatusBadge>
    );
    expect(screen.getByText('503 Service Unavailable').className).toContain('min-w-0');
  });
});
