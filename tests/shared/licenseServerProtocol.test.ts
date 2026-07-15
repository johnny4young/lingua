import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_LICENSE_SERVER_PROTOCOL_VERSIONS,
  LICENSE_SERVER_PROTOCOL_VERSION,
  validateLicenseServerProtocol,
} from '../../src/shared/licenseServerProtocol';
import { LICENSE_SERVER_PROTOCOL_VERSION as SERVER_PROTOCOL_VERSION } from '../../license-server/src/lib/protocol';

describe('license-server protocol handshake', () => {
  it('keeps the client and independently-built worker on the same current version', () => {
    expect(SERVER_PROTOCOL_VERSION).toBe(LICENSE_SERVER_PROTOCOL_VERSION);
    expect(ACCEPTED_LICENSE_SERVER_PROTOCOL_VERSIONS).toEqual([1]);
  });

  it('accepts protocol v1 and returns the validated record', () => {
    const result = validateLicenseServerProtocol({
      protocolVersion: 1,
      ok: true,
      licenseId: 'lic_1',
    });

    expect(result).toEqual({
      ok: true,
      body: { protocolVersion: 1, ok: true, licenseId: 'lic_1' },
    });
  });

  it.each([
    ['missing version', { ok: true }],
    ['future version', { protocolVersion: 2, ok: true }],
    ['string version', { protocolVersion: '1', ok: true }],
    ['array body', [{ protocolVersion: 1 }]],
    ['null body', null],
  ])('rejects %s before payload fields can be read', (_label, body) => {
    expect(validateLicenseServerProtocol(body)).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });
});
