import { describe, expect, it } from 'vitest';
import {
  clipboardMeta,
  generatorPreview,
  jwtPreview,
  PREVIEW_MAX_CHARS,
  readLauncherPreviews,
} from '../../../src/renderer/components/DeveloperUtilities/launcherPreviews';
import { qrVersionAtM } from '../../../src/shared/utilities/qrCapacity';

const NOW = Date.UTC(2026, 10, 11, 13, 2, 0);
const t = (key: string, options?: Record<string, unknown>) => {
  const name = key.split('.').pop() ?? key;
  if (!options) return name;
  if ('version' in options) return `${name}:${String(options.version)}`;
  if ('kind' in options) return `${String(options.kind)}·${String(options.chars)}`;
  return 'count' in options ? `${name}:${String(options.count)}` : name;
};
const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload: object) => [segment({ alg: 'HS256', typ: 'JWT' }), segment(payload), 'c2lnbmF0dXJl'].join('.');
const TOKEN = jwt({ sub: 'user_42', iat: NOW / 1000 - 3600, exp: NOW / 1000 + 58 * 60 + 30 });

describe('launcher previews', () => {
  it('reads what each clipboard tool would answer for a JWT, without quoting it', async () => {
    const { previews, claims } = await readLauncherPreviews(TOKEN, 'jwt', t, 'en');
    expect(claims && jwtPreview(claims, NOW, t, 'en')).toEqual({ text: '58 minutesLeft:58', tone: 'number' });
    expect(claims && jwtPreview(claims, NOW + 30 * 60_000, t, 'en')).toEqual({ text: '28 minutesLeft:28', tone: 'number' });
    expect(previews.hash?.text).toMatch(/^[0-9a-f]{6}…[0-9a-f]{4}$/u);
    expect(previews.base64).toEqual({ text: `${Math.ceil(TOKEN.length / 3) * 4} chars:${Math.ceil(TOKEN.length / 3) * 4}`, tone: 'number' });
    expect(previews['string-inspector']).toEqual({ text: 'hidden:0', tone: 'neutral' });
    expect(previews.url).toEqual({ text: 'noChange', tone: 'none' });
    expect(previews['qr-code']).toEqual({ text: `qr:${String(qrVersionAtM(TOKEN))}`, tone: 'neutral', qr: true });
    expect(JSON.stringify(previews)).not.toContain(TOKEN.slice(0, 12));
  });

  it('marks an expired token, hidden characters and escapes', async () => {
    const { claims } = await readLauncherPreviews(jwt({ exp: NOW / 1000 - 60 }), 'jwt', t, 'en');
    expect(claims && jwtPreview(claims, NOW, t, 'en').tone).toBe('error');
    const { previews: hidden } = await readLauncherPreviews('{"a":"b\u200b"}', 'json', t, 'en');
    expect(hidden['string-inspector']).toEqual({ text: 'hidden:1', tone: 'error' });
    expect(hidden.url).toEqual({ text: 'escaped:10', tone: 'neutral' });
    expect(hidden.json).toEqual({ text: 'object·1', tone: 'neutral' });
  });

  it('answers with the kind own tool for timestamps, UUIDs and colours', async () => {
    expect((await readLauncherPreviews('1794405600', 'timestamp', t, 'en')).previews.timestamp?.tone).toBe('date');
    expect((await readLauncherPreviews('3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'uuid', t, 'en')).previews.uuid).toEqual({ text: 'v4', tone: 'neutral' });
    expect((await readLauncherPreviews('rgb(0, 191, 223)', 'color', t, 'en')).previews.color).toEqual({ text: '#00BFDF', tone: 'neutral', swatch: '#00BFDF' });
    expect((await readLauncherPreviews('[1, 2, 3]', 'json', t, 'en')).previews.json?.text).toBe('array·3');
  });

  it('reads nothing past the preview limit', async () => {
    expect(await readLauncherPreviews('a'.repeat(PREVIEW_MAX_CHARS + 1), 'base64', t, 'en')).toEqual({ previews: {}, claims: null });
  });

  it('names the kind and length, and shows now for the Timestamp Converter only', () => {
    expect(clipboardMeta('jwt', TOKEN.length, t, 'en')).toBe(`jwt·${TOKEN.length}`);
    expect(generatorPreview('timestamp', NOW)).toEqual({ text: String(NOW / 1000), tone: 'number' });
    expect(generatorPreview('json', NOW)).toBeNull();
  });
});
