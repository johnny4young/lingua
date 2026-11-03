import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpJsonTree } from '../../../src/renderer/components/HttpWorkspace/HttpJsonTree';

describe('HttpJsonTree', () => {
  it('overlays the capture control, so its label takes no width from the value', () => {
    render(
      <HttpJsonTree value={{ id: 1 }} query="" search={{ hits: new Set(), count: 0 } as never} wrap={false} captured={new Map()} onCapture={vi.fn()} />
    );
    const capture = screen.getAllByTestId('http-json-capture')[0]!;
    expect(capture.className).toContain('absolute');
    expect(capture.closest('[data-testid="http-json-row"]')!.className).toContain('relative');
  });
});
