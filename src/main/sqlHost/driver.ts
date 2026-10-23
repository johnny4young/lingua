/** How the host makes an engine session, and how cells cross to the renderer. */

import type { Duplex } from 'node:stream';
import type { DriverSession } from '../../shared/sqlDriver';
import type { HostSessionConfig } from './protocol';

/** `connect`, when given, makes each socket the driver opens; a tunnel hands it in. */
export type DriverFactory = (config: HostSessionConfig, connect?: () => Duplex) => Promise<DriverSession>;

/** A cell as the grid takes it: text for wide numbers and dates, base64 for bytes. */
export function toJsonCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  if (Array.isArray(value)) return value.map(toJsonCell);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = toJsonCell(item);
  return out;
}
