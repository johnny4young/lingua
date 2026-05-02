/**
 * RL-037 Vim mode ADR guard — locks the five decision sections, the
 * rollback clause, the revisit triggers, and the adjacent-ADR cross-links
 * so a future edit can't silently strip the reasoning that unblocked the
 * implementation slice.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/VIM_MODE_ADR.md');

describe('VIM_MODE_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted design decision for monaco-vim', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toContain('monaco-vim');
  });

  it('covers library selection, focus ownership, and i18n posture', () => {
    expect(adr).toContain('### 1. Library');
    expect(adr).toContain('### 2. Focus + keystroke ownership');
    expect(adr).toContain('### 3. i18n posture');
    expect(adr).toContain('localized status-bar subclass');
    expect(adr).not.toContain('That slice is explicitly deferred');
  });

  it('documents the Ctrl/Cmd+P Quick Open conflict and its resolution', () => {
    expect(adr).toMatch(/Ctrl\/Cmd\+P/);
    expect(adr).toContain('Quick Open');
  });

  it('preserves the unsaved-changes guard for :q and routes :w through the save pipeline', () => {
    expect(adr).toContain(':q');
    expect(adr).toContain(':w');
    expect(adr).toMatch(/unsaved|dirty/i);
  });

  it('ships a verification matrix and a rollback clause', () => {
    expect(adr).toContain('## Verification matrix');
    expect(adr).toContain('## Rollback');
  });

  it('lists the revisit triggers so future migrations have a bar to clear', () => {
    expect(adr).toContain('## When to revisit');
    for (const marker of ['1.', '2.', '3.', '4.', '5.']) {
      expect(adr).toContain(marker);
    }
  });

  it('cross-links the adjacent ADRs', () => {
    expect(adr).toContain('BUILD_SYSTEM_ADR.md');
    expect(adr).toContain('LANGUAGE_PACK_ADR.md');
    expect(adr).toContain('CAPABILITY_MATRIX.md');
    expect(adr).toContain('RL-037');
  });
});
