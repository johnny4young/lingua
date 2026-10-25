/** An in-process SSH bastion for the SQL host tunnel tests: password `tunnel`, forwarding to any target. */

import net, { type AddressInfo } from 'node:net';
import { Server, utils } from 'ssh2';
import { sshFingerprint } from '../../src/main/sqlSsh/knownHosts';
import type { HostSshConfig } from '../../src/main/sqlHost/protocol';

export interface Bastion {
  port: number;
  /** Targets forwarded through it, as `host:port`. */
  forwarded: string[];
  /** Ends every signed-in session, as a bastion dropping idle clients does. */
  dropSessions: () => void;
  /** The tunnel config that reaches `target` through it. */
  ssh: (target: { host: string; port: number }, password?: string) => HostSshConfig;
  close: () => void;
}

/** An ed25519 host key ssh2 can load: its own keygen emits one it cannot parse about once in 250 tries. */
export function generateHostKey(): { private: string; public: string } {
  for (;;) {
    const key = utils.generateKeyPairSync('ed25519');
    if (!(utils.parseKey(key.private) instanceof Error)) return key;
  }
}

export async function startBastion(): Promise<Bastion> {
  const hostKey = generateHostKey();
  const fingerprint = sshFingerprint(Buffer.from(hostKey.public.split(' ')[1]!, 'base64'));
  const forwarded: string[] = [];
  const signedIn = new Set<{ end: () => void }>();
  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('error', () => undefined);
    signedIn.add(client);
    client.on('close', () => signedIn.delete(client));
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.password === 'tunnel' ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () =>
      client.on('tcpip', (accept, reject, info) => {
        forwarded.push(`${info.destIP}:${info.destPort}`);
        const upstream = net.connect(info.destPort, info.destIP);
        upstream.once('error', () => reject?.());
        upstream.once('connect', () => {
          const channel = accept();
          channel.pipe(upstream).pipe(channel);
        });
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    forwarded,
    dropSessions: () => {
      for (const client of signedIn) client.end();
    },
    ssh: (target, password = 'tunnel') => ({
      hops: [{ host: '127.0.0.1', port, user: 'deploy', known: [{ type: 'ssh-ed25519', fingerprint }], label: { host: 'bastion.test', port } }],
      auth: 'password',
      password,
      target,
    }),
    close: () => server.close(),
  };
}
