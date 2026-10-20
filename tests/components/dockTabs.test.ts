import { describe, expect, it } from 'vitest';
import {
  availableDockTabs,
  resolveDockTab,
  type DockTabAvailability,
} from '../../src/renderer/components/Layout/dockTabs';

const none: DockTabAvailability = {
  stdin: false,
  compare: false,
  variables: false,
  'project-terminal': false,
  debugger: false,
  'browser-preview': false,
  dependencies: false,
  'git-diff': false,
  recipe: false,
};

describe('dock tabs', () => {
  it('lists Console first, then the tabs that apply in board order', () => {
    expect(availableDockTabs(none)).toEqual(['console']);
    expect(
      availableDockTabs({ ...none, recipe: true, compare: true, stdin: true, variables: true })
    ).toEqual(['console', 'stdin', 'compare', 'variables', 'recipe']);
  });

  it('shows the selected tab while it applies', () => {
    expect(resolveDockTab('compare', { ...none, compare: true }, true)).toBe('compare');
  });

  it('falls back to Console when the selected tab stops applying', () => {
    expect(resolveDockTab('compare', none, true)).toBe('console');
  });

  it('lets a browser preview or a live debugger claim a hidden dock', () => {
    expect(resolveDockTab('console', { ...none, 'browser-preview': true }, false)).toBe(
      'browser-preview'
    );
    expect(resolveDockTab('stdin', { ...none, stdin: true, debugger: true }, false)).toBe(
      'debugger'
    );
    expect(resolveDockTab('stdin', { ...none, stdin: true, debugger: true }, true)).toBe('stdin');
  });
});
