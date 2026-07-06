/**
 * T19 — the AI answer renderer. Verifies the Markdown reply is rendered as
 * structured UI (code blocks with a copy button, inline bold/code, lists)
 * rather than raw text, which is what makes the answer easy to read and apply.
 */

import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { ExplainErrorAnswer } from '../../../src/renderer/components/AI/ExplainErrorAnswer';

describe('ExplainErrorAnswer', () => {
  beforeAll(async () => {
    if (!i18next.isInitialized) await initI18n('en');
  });

  it('renders a fenced code block with a copy button', () => {
    render(<ExplainErrorAnswer content={'Fix it:\n```js\nconst x = 1;\n```'} />);
    expect(screen.getByTestId('ai-explain-result')).toBeTruthy();
    expect(screen.getByText('const x = 1;')).toBeTruthy();
    expect(screen.getByTestId('ai-explain-code-copy')).toBeTruthy();
  });

  it('renders bold and inline code in prose', () => {
    render(<ExplainErrorAnswer content={'This is **important** and `code` here.'} />);
    const result = screen.getByTestId('ai-explain-result');
    expect(result.querySelector('strong')?.textContent).toBe('important');
    expect(result.querySelector('code')?.textContent).toBe('code');
  });

  it('renders an ordered list as a real <ol>', () => {
    render(<ExplainErrorAnswer content={'Steps:\n1. First\n2. Second'} />);
    const result = screen.getByTestId('ai-explain-result');
    expect(result.querySelector('ol')).toBeTruthy();
    expect(result.querySelectorAll('ol li').length).toBe(2);
  });

  it('keeps a single list across a blank line between items (1., 2. not 1., 1.)', () => {
    render(<ExplainErrorAnswer content={'Steps:\n1. First\n\n2. Second'} />);
    const result = screen.getByTestId('ai-explain-result');
    expect(result.querySelectorAll('ol').length).toBe(1);
    expect(result.querySelectorAll('ol li').length).toBe(2);
  });

  it('renders markdown headings as bold text without leaking the hashes', () => {
    render(<ExplainErrorAnswer content={'## Suggested Fixes\nDo this.'} />);
    const result = screen.getByTestId('ai-explain-result');
    expect(result.textContent).toContain('Suggested Fixes');
    expect(result.textContent).not.toContain('##');
    expect(result.querySelector('.font-semibold')?.textContent).toBe('Suggested Fixes');
  });

  it('renders plain prose with no fences as a paragraph', () => {
    render(<ExplainErrorAnswer content={'Just a sentence.'} />);
    expect(screen.getByText('Just a sentence.')).toBeTruthy();
    // No stray code blocks when there are no fences.
    expect(screen.queryByTestId('ai-explain-code-copy')).toBeNull();
  });
});
