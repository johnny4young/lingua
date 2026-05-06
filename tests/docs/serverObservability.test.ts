/**
 * RL-091 guard: the server observability docs and runbooks must only
 * reference events that the Workers actually emit today.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const OBSERVABILITY_DOC = resolve(ROOT, 'docs/SERVER_OBSERVABILITY.md');
const RUNBOOKS_DIR = resolve(ROOT, 'docs/runbooks');

function readRunbooks(): string {
  return readdirSync(RUNBOOKS_DIR)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => readFileSync(resolve(RUNBOOKS_DIR, entry), 'utf-8'))
    .join('\n');
}

describe('server observability docs', () => {
  it('keeps the server observability spec and runbooks discoverable', () => {
    expect(existsSync(OBSERVABILITY_DOC)).toBe(true);
    expect(existsSync(RUNBOOKS_DIR)).toBe(true);

    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');
    expect(docsReadme).toContain('SERVER_OBSERVABILITY.md');
    expect(docsReadme).toContain('runbooks/');
  });

  it('does not document non-emitted domain-specific event names as live signals', () => {
    const text = `${readFileSync(OBSERVABILITY_DOC, 'utf-8')}\n${readRunbooks()}`;

    for (const eventName of [
      'licenses.activate.ok',
      'licenses.status.ok',
      'licenses.devices.remove.ok',
      'licenses.recover.start.ok',
      'licenses.recover.confirm.ok',
      'trials.start.ok',
      'education.start.ok',
      'education.confirm.ok',
      'education.renew.ok',
      'webhooks.polar.processed',
      'webhooks.polar.signature_invalid',
      'webhooks.polar.refund_processed',
      'email.sent',
      'email.failed',
      'update.feed.served',
      'update.feed.upstream_5xx',
      'update.asset_proxy.served',
      'update.web_version.served',
    ]) {
      expect(text, `${eventName} is not emitted by the Workers`).not.toContain(eventName);
    }
  });
});
