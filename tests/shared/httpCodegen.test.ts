/**
 * Unit tests for the HTTP request → code snippet generators.
 */

import { describe, expect, it } from 'vitest';
import {
  HTTP_CODEGEN_TARGETS,
  generateHttpCode,
} from '../../src/shared/httpCodegen';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../src/shared/httpWorkspace';

function makeReq(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({ id: 'r1', name: 'req' }),
    method: 'GET',
    url: 'https://api.example.com/users',
    ...overrides,
  };
}

describe('generateHttpCode', () => {
  it('HTTP_CODEGEN_TARGETS is the closed three-target enum', () => {
    expect([...HTTP_CODEGEN_TARGETS].sort()).toEqual([
      'axios',
      'fetch',
      'python-requests',
    ]);
  });

  it('fetch: emits method + url with no body for a GET', () => {
    const code = generateHttpCode(makeReq(), 'fetch');
    expect(code).toContain('await fetch("https://api.example.com/users"');
    expect(code).toContain('method: "GET"');
    expect(code).not.toContain('body:');
  });

  it('fetch: includes composed headers and body for a POST', () => {
    const code = generateHttpCode(
      makeReq({
        method: 'POST',
        headers: [{ name: 'X-Trace', value: 'abc', enabled: true }],
        body: { kind: 'json', content: '{"a":1}' },
      }),
      'fetch'
    );
    expect(code).toContain('method: "POST"');
    expect(code).toContain('"X-Trace": "abc"');
    // Default Content-Type is injected for a json body (matches the wire).
    expect(code).toContain('"Content-Type": "application/json"');
    expect(code).toContain('body: "{\\"a\\":1}"');
  });

  it('axios: lowercases the method and uses data for the body', () => {
    const code = generateHttpCode(
      makeReq({
        method: 'PUT',
        body: { kind: 'text', content: 'hello' },
      }),
      'axios'
    );
    expect(code).toContain('import axios from "axios"');
    expect(code).toContain('method: "put"');
    expect(code).toContain('data: "hello"');
    expect(code).toContain('"Content-Type": "text/plain"');
  });

  it('python-requests: emits requests.request with headers dict + data', () => {
    const code = generateHttpCode(
      makeReq({
        method: 'POST',
        headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
        body: { kind: 'form', content: 'a=1&b=2' },
      }),
      'python-requests'
    );
    expect(code).toContain('import requests');
    expect(code).toContain('requests.request(');
    expect(code).toContain('"POST"');
    expect(code).toContain('"Accept": "application/json"');
    expect(code).toContain('"Content-Type": "application/x-www-form-urlencoded"');
    expect(code).toContain('data="a=1&b=2"');
  });

  it('includes the injected auth header (auth wins the wire)', () => {
    const code = generateHttpCode(
      makeReq({ auth: { kind: 'bearer', token: 'sk-123' } }),
      'fetch'
    );
    expect(code).toContain('"Authorization": "Bearer sk-123"');
  });

  it('drops disabled header rows (matches composeRequestHeaders)', () => {
    const code = generateHttpCode(
      makeReq({
        headers: [
          { name: 'X-On', value: '1', enabled: true },
          { name: 'X-Off', value: '2', enabled: false },
        ],
      }),
      'fetch'
    );
    expect(code).toContain('"X-On": "1"');
    expect(code).not.toContain('X-Off');
  });

  it('escapes quotes / newlines so the snippet is valid source', () => {
    const code = generateHttpCode(
      makeReq({
        method: 'POST',
        body: { kind: 'text', content: 'line1\n"quoted"' },
      }),
      'fetch'
    );
    expect(code).toContain('body: "line1\\n\\"quoted\\""');
  });
});
