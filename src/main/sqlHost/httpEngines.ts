/**
 * Turso (libSQL), Neon and D1 in the SQL host: the shared HTTP engines over a
 * transport whose every socket goes to the address main resolved and checked,
 * with the host name for SNI, the certificate check and the Host header.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import type { DriverSession } from '../../shared/sqlDriver';
import { openD1 } from '../../shared/sqlHttp/d1';
import { openLibsql } from '../../shared/sqlHttp/libsql';
import { openNeon } from '../../shared/sqlHttp/neon';
import { MAX_HTTP_SQL_RESPONSE_BYTES, responseTooLarge, type HttpSqlTransport } from '../../shared/sqlHttp/transport';
import type { DriverFactory } from './driver';
import type { HostSessionConfig } from './protocol';

const REQUEST_TIMEOUT_MS = 120_000;

interface Pinned {
  origin: string;
  transport: HttpSqlTransport;
  /** The certificate the last TLS socket presented. */
  peer: () => tls.PeerCertificate | undefined;
  close: () => void;
}

function pinned(config: HostSessionConfig): Pinned {
  const host = config.servername ?? '';
  const port = config.port ?? 443;
  const secure = config.ssl?.mode !== 'disable';
  if (!host || !config.address) throw new Error('No address to connect to.');
  let peer: tls.PeerCertificate | undefined;
  const make = (): Duplex => {
    const raw = net.connect({ host: config.address!, port });
    if (!secure) return raw;
    // `host` is what the certificate is checked against; SNI carries it unless it is an IP literal.
    const wrapped = tls.connect({ socket: raw, host, rejectUnauthorized: true, ...(net.isIP(host) ? {} : { servername: host }) });
    wrapped.once('secureConnect', () => (peer = wrapped.getPeerCertificate()));
    return wrapped;
  };
  const agent = new (secure ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 4 });
  (agent as unknown as { createConnection: () => Duplex }).createConnection = make;
  const origin = `${secure ? 'https' : 'http'}://${net.isIPv6(host) ? `[${host}]` : host}:${port}`;

  const transport: HttpSqlTransport = (request) =>
    new Promise((resolve, reject) => {
      const url = new URL(request.url);
      // The engines only ever build URLs on the origin main checked.
      if (url.origin !== new URL(origin).origin) {
        reject(new Error('A request left the checked host.'));
        return;
      }
      const client = (secure ? https : http).request(
        url,
        { method: 'POST', agent, headers: { ...request.headers, 'content-length': Buffer.byteLength(request.body) }, timeout: REQUEST_TIMEOUT_MS, ...(request.signal ? { signal: request.signal } : {}) },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_HTTP_SQL_RESPONSE_BYTES) {
              response.destroy(responseTooLarge());
              return;
            }
            chunks.push(chunk);
          });
          response.once('error', reject);
          response.once('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        }
      );
      client.once('timeout', () => client.destroy(Object.assign(new Error('No answer from the server.'), { code: 'ETIMEDOUT' })));
      client.once('error', reject);
      client.end(request.body);
    });

  return { origin, transport, peer: () => peer, close: () => agent.destroy() };
}

/** A shared engine session that reports its certificate and lets go of its sockets on close. */
async function withPinned(config: HostSessionConfig, open: (point: Pinned) => Promise<DriverSession>): Promise<DriverSession> {
  const point = pinned(config);
  let session: DriverSession;
  try {
    session = await open(point);
  } catch (err) {
    point.close();
    throw err;
  }
  return {
    ...session,
    tls() {
      const cert = point.peer();
      if (!cert?.subject) return undefined;
      return { ...(cert.subject.CN ? { subject: String(cert.subject.CN) } : {}), ...(cert.valid_to ? { validTo: cert.valid_to } : {}) };
    },
    async close() {
      await session.close();
      point.close();
    },
  };
}

export const openLibsqlHost: DriverFactory = (config) =>
  withPinned(config, (point) => openLibsql({ origin: point.origin, readOnly: config.readOnly, ...(config.password ? { token: config.password } : {}) }, point.transport));

export const openNeonHost: DriverFactory = (config) =>
  withPinned(config, (point) =>
    openNeon(
      {
        origin: point.origin,
        host: config.host ?? '',
        readOnly: config.readOnly,
        ...(config.database ? { database: config.database } : {}),
        ...(config.user ? { user: config.user } : {}),
        ...(config.password !== undefined ? { password: config.password } : {}),
      },
      point.transport
    )
  );

export const openD1Host: DriverFactory = (config) =>
  withPinned(config, (point) => {
    if (!config.d1) throw new Error('This D1 connection has no account or database id.');
    return openD1({ origin: point.origin, accountId: config.d1.accountId, databaseId: config.d1.databaseId, token: config.password ?? '', readOnly: config.readOnly }, point.transport);
  });
