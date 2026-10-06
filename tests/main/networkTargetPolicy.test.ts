/** Deterministic policy and ownership coverage; all destination lookups are mocked. */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  isPrivateAddress as facadeClassify,
  resolveGuardedNetworkTarget as facadeResolve,
  type GuardedNetworkTarget as FacadeTarget,
  type HttpProxyOptions,
  type LookupImpl as FacadeLookup,
} from '../../src/main/httpProxy';
import type { WebSocketProxyOptions } from '../../src/main/httpWebSocket';
import {
  isPrivateAddress,
  resolveGuardedNetworkTarget,
  SsrfBlockedError,
  type GuardedNetworkTarget,
  type LookupImpl,
} from '../../src/main/networkTargetPolicy';
import { staticSpecifiers, walkStaticImportGraph } from '../../scripts/lib/staticImportGraph.mjs';
import { parseSourceFile, topLevelImports, unwrapExport } from '../__fixtures__/sourceAst';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type ExistingSharedKeys = 'allowPrivateHosts' | 'signal' | 'lookupImpl' | 'maxResponseBodyBytes';
const compatibilityProbe: [
  Assert<Equal<FacadeTarget, GuardedNetworkTarget>>,
  Assert<Equal<FacadeLookup, LookupImpl>>,
  Assert<Equal<Pick<WebSocketProxyOptions, ExistingSharedKeys>, Pick<HttpProxyOptions, ExistingSharedKeys>>>,
] = [true, true, true];

const root = path.resolve(__dirname, '../..');
const leaf = 'src/main/networkTargetPolicy.ts';
const protocols = new Set(['https:']);
const publicAddresses = [
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
];

describe('network destination policy ownership', () => {
  it('preserves historical runtime identities and compile-checked types', () => {
    expect(facadeClassify).toBe(isPrivateAddress);
    expect(facadeResolve).toBe(resolveGuardedNetworkTarget);
    expect(compatibilityProbe).toEqual([true, true, true]);
  });

  it('keeps the policy leaf independent of transport implementations and setup', () => {
    const parsed = parseSourceFile(path.join(root, leaf), leaf);
    expect(topLevelImports(parsed.program).map(entry => entry.source.value)).toEqual(['node:net']);
    expect(staticSpecifiers(parsed.source)).toEqual(['node:net']);
    // Function/class/type declarations have no cache or transport-init lifetime.
    const declarations = new Set([
      'ImportDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration',
      'ClassDeclaration', 'FunctionDeclaration',
    ]);
    for (const statement of parsed.program.body) {
      expect(declarations.has(unwrapExport(statement).type)).toBe(true);
    }
  });

  it.each(['src/main/httpProxy.ts', 'src/main/httpWebSocket.ts'])(
    'makes %s consume the same policy leaf',
    consumer => {
      const parsed = parseSourceFile(path.join(root, consumer), consumer);
      const imports = topLevelImports(parsed.program).map(entry => entry.source.value);
      expect(imports).toContain('./networkTargetPolicy');
      expect(imports).not.toContain('./httpProxy');
      expect(imports).not.toContain('./httpWebSocket');
      const graph = walkStaticImportGraph({ repoRoot: root, entry: consumer });
      expect(graph.parents.has(leaf)).toBe(true);
      expect(graph.parents.has(consumer)).toBe(true);
    }
  );

  it('keeps WebSocket lifecycle options separate from the HTTP contract', () => {
    const source = readFileSync(path.join(root, 'src/main/httpWebSocket.ts'), 'utf8');
    expect(source).not.toContain('HttpProxyOptions');
    const graph = walkStaticImportGraph({ repoRoot: root, entry: 'src/main/httpWebSocket.ts' });
    expect(graph.parents.has('src/main/httpProxy.ts')).toBe(false);
  });
});

describe('network destination resolution contract', () => {
  it('returns the exact checked DNS evidence without mutation or caching', async () => {
    const lookup = vi.fn<LookupImpl>().mockResolvedValueOnce(publicAddresses).mockResolvedValueOnce([]);
    const target = await resolveGuardedNetworkTarget('https://example.com/a?b=c', protocols, false, lookup);
    expect(target.url.href).toBe('https://example.com/a?b=c');
    expect(target.addresses).toBe(publicAddresses);
    expect(publicAddresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    await expect(resolveGuardedNetworkTarget('https://example.com/a', protocols, false, lookup))
      .rejects.toThrow('DNS resolution returned no addresses for example.com');
    expect(lookup.mock.calls).toEqual([['example.com'], ['example.com']]);
  });

  it.each([
    ['https://93.184.216.34/a', '93.184.216.34', 4],
    ['https://[2606:2800:220:1:248:1893:25c8:1946]/a', '2606:2800:220:1:248:1893:25c8:1946', 6],
  ])('classifies literal %s without DNS', async (url, address, family) => {
    const lookup = vi.fn<LookupImpl>();
    const target = await resolveGuardedNetworkTarget(url, protocols, false, lookup);
    expect(target.addresses).toEqual([{ address, family }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['not a URL', 'Invalid URL'],
    ['http://example.com/a', 'Unsupported URL scheme: http:'],
  ])('retains early rejection and error identity for %s', async (url, message) => {
    const lookup = vi.fn<LookupImpl>();
    await expect(resolveGuardedNetworkTarget(url, protocols, true, lookup))
      .rejects.toMatchObject({ name: 'SsrfBlockedError', message });
    await expect(resolveGuardedNetworkTarget(url, protocols, true, lookup))
      .rejects.toBeInstanceOf(SsrfBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets each transport own its allowed protocol set', async () => {
    const lookup: LookupImpl = async () => publicAddresses;
    await expect(resolveGuardedNetworkTarget('wss://example.com/socket', protocols, false, lookup))
      .rejects.toThrow('Unsupported URL scheme: wss:');
    const target = await resolveGuardedNetworkTarget(
      'wss://example.com/socket', new Set(['ws:', 'wss:']), false, lookup
    );
    expect(target.url.protocol).toBe('wss:');
    expect(target.addresses).toBe(publicAddresses);
    expect([...protocols]).toEqual(['https:']);
  });

  it('retains DNS failure text without changing lookup ownership', async () => {
    const lookup = vi.fn<LookupImpl>().mockRejectedValue(new Error('fixture lookup failure'));
    await expect(resolveGuardedNetworkTarget('https://example.com/', protocols, false, lookup))
      .rejects.toMatchObject({
        name: 'SsrfBlockedError',
        message: 'DNS resolution failed for example.com: fixture lookup failure',
      });
    expect(lookup).toHaveBeenCalledOnce();
  });
});

describe('IPv6 forms that embed or route to non-public space', () => {
  it.each([
    ['64:ff9b::7f00:1', 'NAT64 well-known prefix embedding 127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 well-known prefix embedding 169.254.169.254'],
    ['64:ff9b::10.0.0.1', 'NAT64 well-known prefix, dotted tail'],
    ['64:ff9b:1::a00:1', 'NAT64 local-use prefix'],
    ['64:ff9b:1:ffff::8.8.8.8', 'NAT64 local-use prefix even with a public tail'],
    ['2002:7f00:1::', '6to4 embedding 127.0.0.1'],
    ['2002:a9fe:a9fe::1', '6to4 embedding 169.254.169.254'],
    ['2002:c0a8:101::', '6to4 embedding 192.168.1.1'],
    ['fec0::1', 'site-local'],
    ['feff::1', 'top of site-local'],
    ['::ffff:0:7f00:1', 'IPv4-translated 127.0.0.1'],
    ['::ffff:0:10.1.2.3', 'IPv4-translated 10.1.2.3, dotted tail'],
    ['2001:db8::1', 'documentation'],
    ['100::1', 'discard-only'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    ['64:ff9b::808:808', 'NAT64 to public 8.8.8.8, as DNS64 returns on IPv6-only networks'],
    ['64:ff9b::5db8:d822', 'NAT64 to public 93.184.216.34'],
    ['2002:808:808::1', '6to4 to public 8.8.8.8'],
    ['::ffff:0:808:808', 'IPv4-translated public 8.8.8.8'],
    ['fe7f::1', 'just below site-local, outside link-local'],
    ['2001:db9::1', 'just above documentation'],
    ['100:0:0:1::1', 'outside the discard /64'],
    ['2606:2800:220:1:248:1893:25c8:1946', 'ordinary global unicast'],
  ])('allows %s (%s)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('rejects the bracketed NAT64 literal before DNS', async () => {
    const lookup = vi.fn<LookupImpl>();
    await expect(
      resolveGuardedNetworkTarget('https://[64:ff9b::a9fe:a9fe]/latest/meta-data', protocols, false, lookup)
    ).rejects.toThrow('Blocked request to private address 64:ff9b::a9fe:a9fe');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('still honors the explicit private-host opt-in for these forms', async () => {
    const lookup = vi.fn<LookupImpl>();
    const target = await resolveGuardedNetworkTarget('https://[fec0::1]/', protocols, true, lookup);
    expect(target.addresses).toEqual([{ address: 'fec0::1', family: 6 }]);
  });
});

describe('localhost fast path', () => {
  it.each(['https://localhost./', 'https://LOCALHOST./', 'https://api.localhost./', 'https://Api.LocalHost/'])(
    'blocks %s without consulting DNS',
    async (url) => {
      const lookup = vi.fn<LookupImpl>().mockResolvedValue(publicAddresses);
      await expect(resolveGuardedNetworkTarget(url, protocols, false, lookup)).rejects.toThrow(
        'Blocked request to localhost'
      );
      expect(lookup).not.toHaveBeenCalled();
    }
  );

  it('does not treat a name that merely contains localhost as local', async () => {
    const lookup = vi.fn<LookupImpl>().mockResolvedValue(publicAddresses);
    const target = await resolveGuardedNetworkTarget('https://localhost.example.com./', protocols, false, lookup);
    expect(target.addresses).toBe(publicAddresses);
  });
});
