/**
 * What each clipboard tool would answer, read with the shared adapters. The
 * clipboard text only passes through; a preview never quotes it back.
 */
import type { UtilitySuggestionId } from '../../clipboard/pasteHandlers';
import type { DeveloperUtilityId } from '../../data/developerUtilityCatalog';
import { formatNumber } from '../../i18n/formatNumber';
import {
  detectsAsBase64,
  detectsAsUrlEncoded,
  parseColorToRgb,
  rgbToHex,
} from '../../utils/developerUtilityDetection';
import { base64DecodeAdapter, base64EncodeAdapter } from '../../../shared/utilities/base64';
import { hashAdapter } from '../../../shared/utilities/hash';
import { jwtDecodeAdapter } from '../../../shared/utilities/jwtDecode';
import { QR_MAX_BYTES_M, qrVersionAtM } from '../../../shared/utilities/qrCapacity';
import { inspect } from '../../../shared/utilities/stringInspect';
import { encodeUrlComponent } from '../../../shared/utilities/urlComponent';
import { truncateText } from '../../../shared/truncateText';
import { countAnswer, dateText, jwtAnswer } from './toolAnswers';

type PreviewTone = 'neutral' | 'number' | 'string' | 'date' | 'none' | 'error';

export interface LauncherPreview {
  text: string;
  tone: PreviewTone;
  /** Draws the QR glyph before the text. */
  qr?: boolean;
  /** A colour swatch before the text. */
  swatch?: string;
}

export type LauncherPreviews = Partial<Record<DeveloperUtilityId, LauncherPreview>>;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Past this the launcher names the kind and length but reads no previews. */
export const PREVIEW_MAX_CHARS = 100_000;

const HIDDEN_WARNINGS = new Set(['zero-width', 'bidi-control']);

/** The head and tail of `text` around an ellipsis, by code point; reads only both ends. */
export function shortenMiddle(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 2) return text;
  const start = Array.from(text.slice(0, head * 2)).slice(0, head).join('');
  const end = Array.from(text.slice(-tail * 2)).slice(-tail).join('');
  return `${start}…${end}`;
}

/** First six and last four characters of a digest, as the board abbreviates hashes. */
export function shortDigest(hex: string): string {
  return shortenMiddle(hex, 6, 4);
}

/** An output's first characters on one line, read from a bounded head of it. */
export function outputHead(text: string, max: number): string {
  return truncateText(text.slice(0, max * 8).replace(/\s+/gu, ' ').trim(), max);
}

function jsonShape(text: string): string | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (Array.isArray(value)) return `array·${value.length}`;
    if (value !== null && typeof value === 'object') return `object·${Object.keys(value).length}`;
    return typeof value;
  } catch {
    return null;
  }
}

function epochMs(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/u.test(trimmed)) return null;
  const at = Number.parseInt(trimmed, 10) * (trimmed.replace('-', '').length <= 10 ? 1000 : 1);
  return Number.isFinite(at) && !Number.isNaN(new Date(at).getTime()) ? at : null;
}

export interface JwtClaims {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

async function decodeClaims(text: string): Promise<JwtClaims | null> {
  const decoded = await jwtDecodeAdapter.run(text, {});
  return decoded.ok ? (JSON.parse(decoded.value) as JwtClaims) : null;
}

/** A JWT's time left against `now`; decoded once per read, re-answered on each clock tick. */
export function jwtPreview({ header, payload }: JwtClaims, now: number, t: Translate, locale: string): LauncherPreview {
  const { answer } = jwtAnswer(header, payload, now, t, locale);
  return { text: [answer.value, answer.unit].filter(Boolean).join(' '), tone: answer.word ? 'error' : 'number' };
}

function inspectorPreview(text: string, t: Translate): LauncherPreview {
  let hidden = 0;
  let other = 0;
  for (const warning of inspect(text).warnings) {
    if (HIDDEN_WARNINGS.has(warning.kind)) hidden += warning.at.length;
    else other += warning.at.length;
  }
  if (hidden === 0 && other > 0) return { text: t('utilities.launcher.preview.warnings', { count: other }), tone: 'error' };
  return { text: t('utilities.launcher.preview.hidden', { count: hidden }), tone: hidden > 0 ? 'error' : 'neutral' };
}

/** Like the URL tool, an encoded value is answered as a decode. */
function urlPreview(text: string, t: Translate): LauncherPreview | null {
  let escaped: number;
  if (detectsAsUrlEncoded(text)) {
    escaped = text.match(/%[\dA-Fa-f]{2}/gu)?.length ?? 0;
  } else {
    try {
      escaped = encodeUrlComponent(text).split('%').length - 1;
    } catch {
      return null;
    }
  }
  return escaped === 0
    ? { text: t('utilities.launcher.preview.noChange'), tone: 'none' }
    : { text: t('utilities.launcher.preview.escaped', { count: escaped }), tone: 'neutral' };
}

function qrPreview(text: string, t: Translate): LauncherPreview {
  // The QR tool refuses past the level-M byte limit, whatever the mode.
  const version = new TextEncoder().encode(text).length > QR_MAX_BYTES_M ? null : qrVersionAtM(text);
  return version === null
    ? { text: t('utilities.launcher.preview.qrTooLong'), tone: 'none' }
    : { text: t('utilities.launcher.preview.qr', { version }), tone: 'neutral', qr: true };
}

/** The kind's own tool answers about the value itself. */
function ownPreview(kind: UtilitySuggestionId, text: string, locale: string): LauncherPreview | null {
  const trimmed = text.trim();
  switch (kind) {
    case 'json': {
      const shape = jsonShape(trimmed);
      return shape ? { text: shape, tone: 'neutral' } : null;
    }
    case 'timestamp': {
      const at = epochMs(trimmed);
      return at === null ? null : { text: dateText(at, locale), tone: 'date' };
    }
    case 'uuid': {
      const version = trimmed.charAt(14);
      return /^[1-8]$/u.test(version) ? { text: `v${version}`, tone: 'neutral' } : null;
    }
    case 'color': {
      const rgb = parseColorToRgb(trimmed);
      if (!rgb) return null;
      const hex = rgbToHex(rgb).toUpperCase();
      // Converted, never echoed: a hex value reads as rgb() and anything else as hex.
      const text = trimmed.startsWith('#') ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : hex;
      return { text, tone: 'neutral', swatch: hex };
    }
    default:
      return null;
  }
}

/**
 * Every preview the clipboard group can show that does not depend on the
 * clock; tools that cannot read the text get none. A JWT's claims come back
 * for {@link jwtPreview}.
 */
export async function readLauncherPreviews(
  text: string,
  kind: UtilitySuggestionId,
  t: Translate,
  locale: string
): Promise<{ previews: LauncherPreviews; claims: JwtClaims | null }> {
  if (text.length === 0 || text.length > PREVIEW_MAX_CHARS) return { previews: {}, claims: null };
  const [hash, base64, claims] = await Promise.all([
    hashAdapter.run(text, { algorithm: 'SHA-256' }),
    // Like the Base64 tool, a Base64 value is answered as a decode.
    (detectsAsBase64(text) ? base64DecodeAdapter : base64EncodeAdapter).run(text, {}),
    kind === 'jwt' ? decodeClaims(text) : Promise.resolve(null),
  ]);
  const previews: LauncherPreviews = {
    'string-inspector': inspectorPreview(text, t),
    'qr-code': qrPreview(text, t),
  };
  const url = urlPreview(text, t);
  if (url) previews.url = url;
  if (hash.ok) previews.hash = { text: shortDigest(hash.value), tone: 'string' };
  if (base64.ok) {
    const length = countAnswer(base64.value.length, 'utilities.answer.chars', t, locale);
    previews.base64 = { text: `${length.value} ${length.unit}`, tone: 'number' };
  }
  const own = ownPreview(kind, text, locale);
  if (own) previews[kind] = own;
  return { previews, claims };
}

/** Tools whose favorite row shows a live value. */
export function isGenerator(utilityId: DeveloperUtilityId): boolean {
  return utilityId === 'timestamp';
}

/** A generator's live value in Favorites: the Timestamp Converter shows now. */
export function generatorPreview(utilityId: DeveloperUtilityId, now: number): LauncherPreview | null {
  return isGenerator(utilityId) ? { text: String(Math.floor(now / 1000)), tone: 'number' } : null;
}

export function clipboardMeta(kind: UtilitySuggestionId, count: number, t: Translate, locale: string): string {
  return t('utilities.launcher.clipboardMeta', {
    kind: t(`utilities.launcher.kind.${kind}`),
    count,
    chars: formatNumber(count, locale),
  });
}
