import { describe, expect, it } from 'vitest';
import { parseLicensePublicKeyring as parseClientKeyring } from '../../src/shared/license';
import { parseLicensePublicKeyring as parseIssuerKeyring } from '../../license-server/src/lib/sign';

describe('license public-keyring parser boundary', () => {
  it('uses one shared parser while each surface retains its own verifier', () => {
    expect(parseClientKeyring).toBe(parseIssuerKeyring);
  });
});
