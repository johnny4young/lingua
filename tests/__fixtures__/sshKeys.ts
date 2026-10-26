import { utils } from 'ssh2';

export interface SshKeyPassphrase {
  passphrase: string;
  cipher: string;
  rounds: number;
}

/** A key pair ssh2 can load: its own keygen emits an ed25519 key it cannot parse about once in 250 tries. */
export function generateSshKeyPair(type: 'ed25519' | 'ecdsa' = 'ed25519', protection?: SshKeyPassphrase): utils.KeyPairReturn {
  for (;;) {
    const key = type === 'ecdsa' ? utils.generateKeyPairSync('ecdsa', { bits: 256, ...protection }) : utils.generateKeyPairSync('ed25519', protection);
    if (!(utils.parseKey(key.private, protection?.passphrase) instanceof Error) && !(utils.parseKey(key.public) instanceof Error)) return key;
  }
}
