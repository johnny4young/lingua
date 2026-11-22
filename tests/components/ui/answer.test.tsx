import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DotLeader, LeaderRow, ResultNumeral, TypeTag } from '../../../src/renderer/components/ui/answer';
import { Kbd } from '../../../src/renderer/components/ui/ModalShell';

describe('TypeTag', () => {
  it('renders the label with the small-caps class', () => {
    render(<TypeTag>float</TypeTag>);
    expect(screen.getByText('float').classList.contains('type-tag')).toBe(true);
  });
});

describe('ResultNumeral', () => {
  it('renders the value and its italic unit at the requested size', () => {
    render(<ResultNumeral value="1.24" unit="s" size="lg" data-testid="numeral" />);
    const numeral = screen.getByTestId('numeral');
    expect(numeral.getAttribute('data-size')).toBe('lg');
    expect(numeral.getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByText('1.24').classList.contains('result-numeral-value')).toBe(true);
    expect(screen.getByText('s').classList.contains('result-numeral-unit')).toBe(true);
  });

  it('omits the unit when there is none and takes the error tone for a failure', () => {
    render(<ResultNumeral value="KeyError" tone="error" data-testid="numeral" />);
    const numeral = screen.getByTestId('numeral');
    expect(numeral.getAttribute('data-size')).toBe('md');
    expect(numeral.getAttribute('data-tone')).toBe('error');
    expect(numeral.querySelector('.result-numeral-unit')).toBe(null);
  });
});

describe('LeaderRow', () => {
  it('reads label then value, with a hidden leader between them', () => {
    render(<LeaderRow label="p95" value="151.4" data-testid="row" />);
    const row = screen.getByTestId('row');
    expect(row.textContent).toBe('p95151.4');
    const [label, leader, value] = [...row.children];
    expect(label?.textContent).toBe('p95');
    expect(leader?.getAttribute('aria-hidden')).toBe('true');
    expect(leader?.classList.contains('dot-leader')).toBe(true);
    expect(value?.textContent).toBe('151.4');
    expect(row.hasAttribute('data-enter')).toBe(false);
  });

  it('opts into the answer motion and tints the leader for an error', () => {
    render(<LeaderRow label="cache" value="KeyError" tone="error" enter data-testid="row" />);
    const row = screen.getByTestId('row');
    expect(row.getAttribute('data-enter')).toBe('');
    expect(row.querySelector('.dot-leader')?.getAttribute('data-tone')).toBe('error');
  });
});

describe('DotLeader', () => {
  it('is decorative', () => {
    const { container } = render(<DotLeader />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('neutral');
  });
});

describe('Kbd', () => {
  it('renders a keycap', () => {
    render(<Kbd>⌘↵</Kbd>);
    expect(screen.getByText('⌘↵').tagName).toBe('KBD');
  });
});
