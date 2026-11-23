import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineMarker } from '../../../src/renderer/components/ui/InlineMarker';

describe('InlineMarker', () => {
  it('reads leader, type, then the value in its value-type colour', () => {
    render(<InlineMarker value="10" type="number" />);
    const marker = screen.getByTestId('inline-marker');
    const value = screen.getByTestId('inline-marker-value');
    expect(marker.firstElementChild?.classList.contains('dot-leader')).toBe(true);
    expect(screen.getByText('number').classList.contains('type-tag')).toBe(true);
    expect(value.textContent).toBe('10');
    expect(value.classList.contains('value-tone')).toBe(true);
    expect(value.dataset.tone).toBe('number');
    expect(screen.getByText('number').compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['string', 'string'],
    ['Boolean', 'boolean'],
    ['None', 'none'],
    ['date', 'date'],
    ['error', 'error'],
    ['KeyError', 'error'],
    ['NoneType', 'none'],
    ['constructor', undefined],
  ])('maps the %s type to the %s tone', (type, tone) => {
    render(<InlineMarker value="x" type={type} />);
    expect(screen.getByTestId('inline-marker-value').dataset.tone).toBe(tone);
  });

  it('marks @watch before the type and tints an error leader', () => {
    const { rerender } = render(<InlineMarker value="50" type="number" watch />);
    expect(screen.getByText('@WATCH').classList.contains('lingua-inline-result-watch')).toBe(true);
    rerender(<InlineMarker value="KeyError" type="error" />);
    expect(screen.queryByText('@WATCH')).toBe(null);
    expect(screen.getByTestId('inline-marker').querySelector('.dot-leader')?.getAttribute('data-tone')).toBe('error');
  });
});
