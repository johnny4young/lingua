/**
 * RL-025 Slice A - dependency detection store + content-hash helper.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  useDependencyDetectionStore,
  computeDetectionHash,
} from '../../src/renderer/stores/dependencyDetectionStore';

describe('useDependencyDetectionStore', () => {
  beforeEach(() => {
    useDependencyDetectionStore.getState().clear();
  });

  afterEach(() => {
    useDependencyDetectionStore.getState().clear();
  });

  it('starts with an empty map', () => {
    expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);
  });

  it('setDetection writes per-tab entries', () => {
    useDependencyDetectionStore.getState().setDetection('tab-1', {
      tabId: 'tab-1',
      language: 'javascript',
      detectionHash: 'h1',
      dependencies: [{ name: 'lodash', kind: 'import', status: 'installed' }],
      classifiedAt: 1,
    });
    expect(useDependencyDetectionStore.getState().byTab.get('tab-1')).toMatchObject({
      detectionHash: 'h1',
      dependencies: [{ name: 'lodash', status: 'installed' }],
    });
  });

  it('evictTab removes only the named tab', () => {
    const store = useDependencyDetectionStore.getState();
    store.setDetection('a', {
      tabId: 'a',
      language: 'javascript',
      detectionHash: 'ha',
      dependencies: [],
      classifiedAt: 1,
    });
    store.setDetection('b', {
      tabId: 'b',
      language: 'python',
      detectionHash: 'hb',
      dependencies: [],
      classifiedAt: 1,
    });
    store.evictTab('a');
    expect(useDependencyDetectionStore.getState().byTab.has('a')).toBe(false);
    expect(useDependencyDetectionStore.getState().byTab.has('b')).toBe(true);
  });

  it('clear wipes everything', () => {
    const store = useDependencyDetectionStore.getState();
    store.setDetection('a', {
      tabId: 'a',
      language: 'javascript',
      detectionHash: 'ha',
      dependencies: [],
      classifiedAt: 1,
    });
    store.clear();
    expect(useDependencyDetectionStore.getState().byTab.size).toBe(0);
  });

  it('setDetection preserves installing status for in-flight names', () => {
    // RL-025 Slice B reviewer fix — a re-detection cycle that fires
    // mid-install (typical: user edits the buffer while npm runs)
    // must not overwrite the optimistic `'installing'` status back
    // to `'detected'`. The resolver only sees what's on disk.
    const store = useDependencyDetectionStore.getState();
    store.setDetection('tab-flight', {
      tabId: 'tab-flight',
      language: 'javascript',
      detectionHash: 'h1',
      dependencies: [
        { name: 'lodash', kind: 'import', status: 'detected' },
        { name: 'react', kind: 'import', status: 'detected' },
      ],
      classifiedAt: 1,
    });
    store.startInstall('tab-flight', 'run-1', ['lodash']);
    // Detection cycle fires after the install started but before
    // it finished — the resolver still sees `lodash` as `detected`
    // because `node_modules/lodash/` has not landed yet.
    store.setDetection('tab-flight', {
      tabId: 'tab-flight',
      language: 'javascript',
      detectionHash: 'h2',
      dependencies: [
        { name: 'lodash', kind: 'import', status: 'detected' },
        { name: 'react', kind: 'import', status: 'detected' },
      ],
      classifiedAt: 2,
    });
    const merged = useDependencyDetectionStore
      .getState()
      .byTab.get('tab-flight');
    expect(
      merged?.dependencies.find((d) => d.name === 'lodash')?.status
    ).toBe('installing');
    expect(
      merged?.dependencies.find((d) => d.name === 'react')?.status
    ).toBe('detected');
  });
});

describe('computeDetectionHash', () => {
  it('returns a stable token for identical inputs', () => {
    const a = computeDetectionHash('javascript', "import 'lodash';");
    const b = computeDetectionHash('javascript', "import 'lodash';");
    expect(a).toBe(b);
  });

  it('changes when the buffer content changes', () => {
    const a = computeDetectionHash('javascript', "import 'lodash';");
    const b = computeDetectionHash('javascript', "import 'lodashy';");
    expect(a).not.toBe(b);
  });

  it('changes when same-length imports change in the middle of a file', () => {
    const prefix = `${'a'.repeat(48)}\n`;
    const suffix = `\n${'z'.repeat(48)}`;
    const a = computeDetectionHash(
      'javascript',
      `${prefix}import one from 'axios';${suffix}`
    );
    const b = computeDetectionHash(
      'javascript',
      `${prefix}import one from 'react';${suffix}`
    );
    expect(a).not.toBe(b);
  });

  it('changes when the language changes', () => {
    const a = computeDetectionHash('javascript', "import 'lodash';");
    const b = computeDetectionHash('typescript', "import 'lodash';");
    expect(a).not.toBe(b);
  });

  it('changes when the classification context changes', () => {
    const a = computeDetectionHash(
      'javascript',
      "import 'lodash';",
      '/project-a/app.js'
    );
    const b = computeDetectionHash(
      'javascript',
      "import 'lodash';",
      '/project-b/app.js'
    );
    expect(a).not.toBe(b);
  });

  it('handles the empty buffer without throwing', () => {
    expect(computeDetectionHash('python', '')).toContain('empty');
  });
});
