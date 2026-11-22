import { describe, expect, it } from 'vitest';
import {
  availableDockTabs,
  isDockSplit,
  resolveDockTab,
  type DockTabAvailability,
} from '../../src/renderer/components/Layout/dockTabs';

const none: DockTabAvailability = {
  stdin: false,
  compare: false,
  variables: false,
  timeline: false,
  'project-terminal': false,
  tests: false,
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

  it('lists Tests before Terminal, the order they sit side by side', () => {
    expect(availableDockTabs({ ...none, tests: true, 'project-terminal': true })).toEqual([
      'console',
      'tests',
      'project-terminal',
    ]);
  });

  it('splits Tests and Terminal only on a wide dock, with both available and one of them shown', () => {
    const both = { ...none, tests: true, 'project-terminal': true };
    expect(isDockSplit('tests', both, true)).toBe(true);
    expect(isDockSplit('project-terminal', both, true)).toBe(true);
    expect(isDockSplit('tests', both, false)).toBe(false);
    expect(isDockSplit('console', both, true)).toBe(false);
    expect(isDockSplit('tests', { ...none, tests: true }, true)).toBe(false);
  });
});
