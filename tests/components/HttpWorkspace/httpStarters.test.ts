import { describe, expect, it } from 'vitest';
import { isPristineRequest } from '../../../src/renderer/components/HttpWorkspace/httpStarters';
import type { HttpRequestV1 } from '../../../src/shared/httpWorkspaceSchema';

const fresh: HttpRequestV1 = {
  version: 1,
  id: 'r1',
  name: 'Untitled request',
  method: 'GET',
  url: '',
  headers: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('isPristineRequest', () => {
  it('accepts a new request, whatever its method', () => {
    expect(isPristineRequest(fresh)).toBe(true);
    expect(isPristineRequest({ ...fresh, method: 'PUT', body: { kind: 'json', content: ' ' } })).toBe(true);
  });

  it('refuses a request someone has set up', () => {
    const setUp: Array<Partial<HttpRequestV1>> = [
      { url: 'https://example.com' },
      { headers: [{ name: 'Cookie', value: 'a=b', enabled: true }] },
      { body: { kind: 'text', content: 'hi' } },
      { auth: { kind: 'bearer', token: '{{token}}' } as HttpRequestV1['auth'] },
      { queryParams: [{ key: 'q', value: '1', enabled: true }] as HttpRequestV1['queryParams'] },
      { captures: [{}] as unknown as HttpRequestV1['captures'] },
      { assertions: [{}] as unknown as HttpRequestV1['assertions'] },
      { variables: [{}] as unknown as HttpRequestV1['variables'] },
    ];
    for (const patch of setUp) expect(isPristineRequest({ ...fresh, ...patch })).toBe(false);
  });
});
