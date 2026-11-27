import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from '../../../src/renderer/components/ui/ModalShell';

describe('ModalShell', () => {
  it('ends above a docked notice and lets the body shrink to fit', () => {
    render(
      <ModalShell onClose={vi.fn()} labelledById="title" header={<h2 id="title">Dialog</h2>} bodyMaxHeightClassName="h-[600px]">
        <p>Body</p>
      </ModalShell>
    );
    const dialog = screen.getByRole('dialog');
    const scrim = dialog.parentElement!;
    expect(scrim.style.bottom).toBe('var(--notice-row-offset, 0px)');
    expect(dialog.className).toContain('max-h-full');
    expect(dialog.className).toContain('flex-col');
    const body = dialog.querySelector('[data-modal-scroll-region]')!;
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('h-[600px]');
  });
});
