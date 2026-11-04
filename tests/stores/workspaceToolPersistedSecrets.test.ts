import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceToolStore } from '@/stores/workspaceToolStore';
import type { HttpRequestV1, HttpResponseV1 } from '@/../shared/httpWorkspaceSchema';

const TOKEN = 'tok_0123456789abcdef';
const STORAGE_KEY = 'lingua-workspace-tool-state';

const captureRule = { id: 'c', source: 'body-json', path: 'access', targetVariable: 'jwt', enabled: true } as const;
const response = {
  kind: 'success', status: 200, statusText: 'OK', url: 'https://api.test/login', finalUrl: 'https://api.test/login',
  headers: [], body: JSON.stringify({ access: TOKEN }), contentType: 'application/json',
  durationMs: 1, recordedAt: '2026-11-03T00:00:00.000Z',
} as unknown as HttpResponseV1;
const request = { id: 'login', name: 'Login', method: 'POST', url: 'https://api.test/login', headers: [], captures: [captureRule] } as unknown as HttpRequestV1;

beforeEach(() => {
  localStorage.clear();
});

describe('workspace tool store persistence', () => {
  it('writes a captured token masked and keeps it in the session for chain tags', () => {
    useWorkspaceToolStore.setState({ requests: [request], responsesByRequestId: { login: [response] } });
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(stored).toContain('<redacted>');
    expect(stored).not.toContain(TOKEN);
    expect(useWorkspaceToolStore.getState().responsesByRequestId.login![0]!.body).toContain(TOKEN);
  });
});
