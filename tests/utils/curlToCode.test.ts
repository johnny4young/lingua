/**
 * RL-070 — Unit tests for the cURL → Code helper. The 10-invocation
 * fixture required by the PLAN.md acceptance criteria lives below
 * (bare GET, GET with query, POST JSON, POST form, PUT, DELETE, basic
 * auth, custom header stack, line continuation, cookie). Each fixture
 * is pinned against the primary target (fetch) with spot checks
 * against the other three to catch regressions without exploding
 * the fixture surface to 40 assertions.
 */

import { describe, expect, it } from 'vitest';
import {
  CURL_TO_CODE_MAX_BYTES,
  convertCurlToCode,
  generateCode,
  parseCurlCommand,
} from '../../src/renderer/utils/curlToCode';

describe('parseCurlCommand', () => {
  it('rejects empty input with the empty error key', () => {
    expect(parseCurlCommand('')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.empty',
    });
  });

  it('rejects an invocation with no URL with the missingUrl error key', () => {
    expect(parseCurlCommand('curl -X POST')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.missingUrl',
    });
  });

  it('rejects unclosed quotes with the parseFailure error key and a raw message', () => {
    const result = parseCurlCommand(`curl -H "unclosed`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.curlToCode.error.parseFailure');
    expect(result.message).toMatch(/Unclosed/);
  });

  it('rejects --data-binary @file with the fileBodyUnsupported error key', () => {
    expect(parseCurlCommand('curl --data-binary @payload.bin http://x')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.fileBodyUnsupported',
    });
  });

  it('rejects --data @file because cURL treats it as a file read, not a literal body', () => {
    expect(parseCurlCommand('curl --data @payload.txt http://x')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.fileBodyUnsupported',
    });
  });

  it('keeps --data-raw @value literal because cURL does not read files for that flag', () => {
    const result = parseCurlCommand('curl --data-raw @literal http://x');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.body).toBe('@literal');
  });

  it('rejects payloads over the byte cap', () => {
    const huge = 'curl ' + 'http://x.com?q=' + 'a'.repeat(CURL_TO_CODE_MAX_BYTES);
    expect(parseCurlCommand(huge)).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.tooLarge',
    });
  });

  it('defaults the method to GET when no body is present', () => {
    const result = parseCurlCommand('curl http://x.com');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.method).toBe('GET');
  });

  it('defaults the method to POST when -d is present without explicit -X', () => {
    const result = parseCurlCommand("curl -d 'hello' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.method).toBe('POST');
    expect(result.command.body).toBe('hello');
  });

  it('preserves empty quoted option values instead of consuming the URL as the value', () => {
    const result = parseCurlCommand("curl -d '' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.url).toBe('http://x.com');
    expect(result.command.method).toBe('POST');
    expect(result.command.body).toBe('');
  });

  it('respects explicit -X override', () => {
    const result = parseCurlCommand("curl -X PUT -d 'hello' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.method).toBe('PUT');
  });

  it('supports attached short option values and long --flag=value values', () => {
    const shortResult = parseCurlCommand(
      `curl --url=https://api.example.com/users -XPOST -H'Accept: application/json' -d'{"a":1}'`
    );
    expect(shortResult.ok).toBe(true);
    if (!shortResult.ok) return;
    expect(shortResult.command.url).toBe('https://api.example.com/users');
    expect(shortResult.command.method).toBe('POST');
    expect(shortResult.command.headers.Accept).toBe('application/json');
    expect(shortResult.command.body).toBe('{"a":1}');

    const longResult = parseCurlCommand(
      `curl --request=PATCH --header='X-Trace: 1' --data-raw=abc https://api.example.com/items/1`
    );
    expect(longResult.ok).toBe(true);
    if (!longResult.ok) return;
    expect(longResult.command.method).toBe('PATCH');
    expect(longResult.command.headers['X-Trace']).toBe('1');
    expect(longResult.command.body).toBe('abc');
  });

  it('collects multiple -d flags by joining with &', () => {
    const result = parseCurlCommand("curl -d 'a=1' -d 'b=2' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.body).toBe('a=1&b=2');
  });

  it('parses -H headers into the headers map', () => {
    const result = parseCurlCommand(
      "curl -H 'Content-Type: application/json' -H 'X-Token: abc' http://x.com"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.headers['Content-Type']).toBe('application/json');
    expect(result.command.headers['X-Token']).toBe('abc');
  });

  it('parses basic auth from -u user:pass', () => {
    const result = parseCurlCommand("curl -u 'alice:secret' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.basicAuth).toEqual({ user: 'alice', password: 'secret' });
  });

  it('promotes -G + body to a query string and forces GET', () => {
    const result = parseCurlCommand("curl -G -d 'q=hello' http://x.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.url).toBe('http://x.com?q=hello');
    expect(result.command.method).toBe('GET');
    expect(result.command.body).toBeNull();
  });

  it('handles line continuations (backslash + newline)', () => {
    const input = `curl \\\n  -X POST \\\n  -H "X: y" \\\n  http://x.com`;
    const result = parseCurlCommand(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.method).toBe('POST');
    expect(result.command.headers['X']).toBe('y');
    expect(result.command.url).toBe('http://x.com');
  });

  it('keeps POSIX single-quoted bodies verbatim', () => {
    const result = parseCurlCommand(`curl -d 'a=1&b=2' http://x.com`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.body).toBe('a=1&b=2');
  });

  it('surfaces unknown flags as warnings rather than hard errors', () => {
    const result = parseCurlCommand(`curl --retry 3 http://x.com`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.warnings.length).toBeGreaterThan(0);
    expect(result.command.warnings[0]).toContain('--retry');
  });

  it('percent-encodes --data-urlencode values per cURL rules', () => {
    // `name=value` → encode only value.
    const named = parseCurlCommand(`curl --data-urlencode 'name=hello world' http://x.com`);
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.command.body).toBe('name=hello%20world');

    // Bare value → encode the whole thing.
    const bare = parseCurlCommand(`curl --data-urlencode 'hello world&foo' http://x.com`);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.command.body).toBe('hello%20world%26foo');
  });

  it('warns when -u and an explicit Authorization header coexist', () => {
    const result = parseCurlCommand(
      `curl -u alice:secret -H 'Authorization: Bearer token' http://x.com`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.warnings.some((w) => w.includes('basic auth'))).toBe(true);
  });

  it('tolerates CRLF and LF line continuations without leaking \\r into tokens', () => {
    const crlf = parseCurlCommand('curl \\\r\n  -X POST \\\r\n  http://x.com');
    expect(crlf.ok).toBe(true);
    if (!crlf.ok) return;
    expect(crlf.command.method).toBe('POST');
    expect(crlf.command.url).toBe('http://x.com');

    const lfcr = parseCurlCommand('curl \\\n\r  -X POST \\\n\r  http://x.com');
    expect(lfcr.ok).toBe(true);
    if (!lfcr.ok) return;
    expect(lfcr.command.url).toBe('http://x.com');
    expect(lfcr.command.method).toBe('POST');
  });
});

describe('generateCode — fetch target', () => {
  it('emits a fetch call with method, headers, and body for a JSON POST', () => {
    const parsed = parseCurlCommand(
      `curl -X POST -H 'Content-Type: application/json' -d '{"a":1}' https://api.example.com/users`
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const code = generateCode(parsed.command, 'fetch');
    expect(code).toContain('await fetch("https://api.example.com/users"');
    expect(code).toContain('method: "POST"');
    expect(code).toContain('"Content-Type": "application/json"');
    expect(code).toContain('body: "{\\"a\\":1}"');
  });

  it('embeds basic auth as an Authorization header', () => {
    const result = convertCurlToCode(`curl -u alice:secret http://x.com`, { target: 'fetch' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('Authorization');
    expect(result.code).toContain('Basic');
  });
});

describe('generateCode — undici target', () => {
  it('produces a Node undici.request call with the expected shape', () => {
    const result = convertCurlToCode(
      `curl -X PUT -H 'X-Token: abc' https://api.example.com/items/1`,
      { target: 'undici' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain("import { request } from 'undici';");
    expect(result.code).toContain('method: "PUT"');
    expect(result.code).toContain('"X-Token": "abc"');
  });
});

describe('generateCode — requests (Python) target', () => {
  it('produces a requests.request call with headers and data kwargs', () => {
    const result = convertCurlToCode(
      `curl -X POST -H 'Content-Type: application/json' -d '{"a":1}' https://api.example.com/users`,
      { target: 'requests' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('import requests');
    expect(result.code).toContain('requests.request("POST", "https://api.example.com/users"');
    expect(result.code).toContain('headers={"Content-Type": "application/json"}');
    expect(result.code).toContain('data="{\\"a\\":1}"');
  });

  it('emits auth= tuple for basic auth rather than an inline header', () => {
    const result = convertCurlToCode(`curl -u alice:secret http://x.com`, {
      target: 'requests',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('auth=("alice", "secret")');
    expect(result.code).not.toContain('Authorization');
  });
});

describe('generateCode — net/http (Go) target', () => {
  it('emits a Go program with http.NewRequest and Header.Set calls', () => {
    const result = convertCurlToCode(
      `curl -X DELETE -H 'X-Token: abc' https://api.example.com/items/7`,
      { target: 'net-http' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('package main');
    expect(result.code).toContain('"net/http"');
    expect(result.code).toContain(
      'http.NewRequest("DELETE", "https://api.example.com/items/7"'
    );
    expect(result.code).toContain('req.Header.Set("X-Token", "abc")');
  });

  it('uses SetBasicAuth for -u rather than hand-crafting the Authorization header', () => {
    const result = convertCurlToCode(`curl -u alice:secret http://x.com`, {
      target: 'net-http',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('req.SetBasicAuth("alice", "secret")');
    expect(result.code).not.toContain('"Authorization"');
  });

  it('does not import strings when the generated Go request has no body', () => {
    const result = convertCurlToCode(`curl https://api.example.com/users`, {
      target: 'net-http',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('"io"');
    expect(result.code).toContain('"net/http"');
    expect(result.code).not.toContain('"strings"');
  });
});

describe('generateCode — warning comments', () => {
  it('sanitizes warning comments so user input cannot break generated code structure', () => {
    const result = convertCurlToCode('curl -H "Bad\nconsole.log(1)" http://x.com', {
      target: 'fetch',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('// Header without colon: Bad console.log(1)');
    expect(result.code).not.toContain('\nconsole.log(1)');
  });
});

describe('convertCurlToCode — 10-invocation acceptance fixture', () => {
  // Each fixture exercises a distinct cURL shape documented in the
  // acceptance criteria for RL-070. Only the primary assertion is
  // pinned here; the target-specific tests above cover the codegen
  // branches individually.
  const fixtures: Array<{ label: string; curl: string; expectIn: string[] }> = [
    {
      label: '1) bare GET',
      curl: 'curl https://api.example.com/users',
      expectIn: ['method: "GET"', '"https://api.example.com/users"'],
    },
    {
      label: '2) GET with query string',
      curl: 'curl "https://api.example.com/search?q=lingua&limit=10"',
      expectIn: ['method: "GET"', 'q=lingua&limit=10'],
    },
    {
      label: '3) POST JSON',
      curl:
        `curl -X POST -H 'Content-Type: application/json' -d '{"name":"Lingua"}' https://api.example.com/users`,
      expectIn: ['method: "POST"', '"Content-Type": "application/json"', '{\\"name\\":\\"Lingua\\"}'],
    },
    {
      label: '4) POST form-urlencoded',
      curl:
        `curl -X POST -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2' https://api.example.com/form`,
      expectIn: ['method: "POST"', 'a=1&b=2'],
    },
    {
      label: '5) PUT',
      curl: 'curl -X PUT -d "updated" https://api.example.com/items/5',
      expectIn: ['method: "PUT"', '"updated"'],
    },
    {
      label: '6) DELETE',
      curl: 'curl -X DELETE https://api.example.com/items/9',
      expectIn: ['method: "DELETE"'],
    },
    {
      label: '7) basic auth',
      curl: `curl -u 'alice:secret' https://api.example.com/me`,
      expectIn: ['Authorization', 'Basic'],
    },
    {
      label: '8) custom header stack',
      curl:
        `curl -H 'Accept: application/json' -H 'X-Request-Id: 42' -H 'User-Agent: Lingua/1.0' https://api.example.com/me`,
      expectIn: ['"Accept": "application/json"', '"X-Request-Id": "42"', '"User-Agent": "Lingua/1.0"'],
    },
    {
      label: '9) line continuation',
      curl: `curl \\\n  -X POST \\\n  -H "X-One: 1" \\\n  https://api.example.com/c`,
      expectIn: ['method: "POST"', '"X-One": "1"', '"https://api.example.com/c"'],
    },
    {
      label: '10) cookie',
      curl: `curl --cookie 'session=abc' https://api.example.com/me`,
      expectIn: ['"Cookie": "session=abc"'],
    },
  ];

  for (const fixture of fixtures) {
    it(`fetch — ${fixture.label}`, () => {
      const result = convertCurlToCode(fixture.curl, { target: 'fetch' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const needle of fixture.expectIn) {
        expect(result.code).toContain(needle);
      }
    });
  }
});
