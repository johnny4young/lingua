import { utils } from 'ssh2';

export type SshKeyPassphrase = Extract<utils.KeyPairOptions, { passphrase: unknown }>;

/**
 * A key pair ssh2 can load. Its ed25519 keygen strips leading zero bytes from the public key,
 * so one key in 256 comes out malformed; regenerate those, and fail rather than loop forever.
 */
export function generateSshKeyPair(type: 'ed25519' | 'ecdsa' = 'ed25519', protection?: SshKeyPassphrase): utils.KeyPairReturn {
  let problem: Error | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = type === 'ecdsa' ? utils.generateKeyPairSync('ecdsa', { bits: 256, ...protection }) : utils.generateKeyPairSync('ed25519', protection);
    const parsed = utils.parseKey(key.private, protection?.passphrase);
    if (!(parsed instanceof Error)) return key;
    problem = parsed;
  }
  throw problem;
}
