import { describe, expect, it } from 'vitest';
import {
  createBlankHttpRequest as createBlankFromFacade,
  HTTP_METHODS as METHODS_FROM_FACADE,
  utf8ByteLength as byteLengthFromFacade,
  parseHttpRequest,
} from '../../src/shared/httpWorkspace';
import {
  createBlankHttpRequest,
  HTTP_METHODS,
  utf8ByteLength,
} from '../../src/shared/httpWorkspaceSchema';

describe('HTTP workspace schema boundary', () => {
  it('preserves the historical facade exports', () => {
    expect(METHODS_FROM_FACADE).toBe(HTTP_METHODS);
    expect(createBlankFromFacade).toBe(createBlankHttpRequest);
    expect(byteLengthFromFacade).toBe(utf8ByteLength);
  });

  it('creates a request accepted by the implementation parser', () => {
    const request = createBlankHttpRequest({
      id: 'request-1',
      name: 'Health check',
      now: '2026-07-31T12:00:00.000Z',
    });

    expect(parseHttpRequest(request)).toEqual(request);
    expect(utf8ByteLength('Lingua 🚀')).toBe(11);
  });
});
