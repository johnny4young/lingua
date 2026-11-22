import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHttpTestAnswers } from '../../../src/renderer/components/HttpWorkspace/useHttpTestAnswers';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspace';
import type { HttpEnvironmentV1 } from '../../../src/shared/httpEnvironment';

const NOW = '2026-11-20T10:00:00.000Z';
const env: HttpEnvironmentV1 = {
  version: 1,
  id: 'staging',
  name: 'staging',
  variables: [
    { id: '1', key: 'baseUrl', value: 'https://api.example.com', secret: false },
    { id: '2', key: 'API_TOKEN', value: 'abc', secret: false },
    { id: '3', key: 'session', value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', secret: false },
    { id: '4', key: 'password', value: 'hunter2', secret: true },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

describe('useHttpTestAnswers variables', () => {
  it('masks a value named or shaped like a credential even when its row is not marked secret', () => {
    const request = {
      ...createBlankHttpRequest({ id: 'r', now: NOW }),
      url: '{{baseUrl}}/x?t={{API_TOKEN}}&s={{session}}&p={{password}}&m={{missing}}',
    };
    const { result } = renderHook(() =>
      useHttpTestAnswers({
        assertions: [],
        applyAssertions: vi.fn(),
        response: undefined,
        latest: true,
        visible: true,
        snapshotChanges: undefined,
        request,
        env,
        sources: new Map(),
        environmentName: 'staging',
      })
    );
    const byKey = Object.fromEntries((result.current.tests.variables ?? []).map((row) => [row.key, row]));
    expect(byKey.baseUrl).toMatchObject({ state: 'resolved', value: 'https://api.example.com' });
    for (const key of ['API_TOKEN', 'session', 'password']) {
      expect(byKey[key]?.state).toBe('secret');
      expect(byKey[key]?.value).toBeUndefined();
    }
    expect(byKey.missing?.state).toBe('unresolved');
  });

  it('reads no variables while the Tests tab is hidden', () => {
    const request = { ...createBlankHttpRequest({ id: 'r', now: NOW }), url: '{{baseUrl}}/x' };
    const { result } = renderHook(() =>
      useHttpTestAnswers({ assertions: [], applyAssertions: vi.fn(), response: undefined, latest: true, visible: false, snapshotChanges: undefined, request, env, sources: new Map(), environmentName: 'staging' })
    );
    expect(result.current.tests.variables).toEqual([]);
  });
});
