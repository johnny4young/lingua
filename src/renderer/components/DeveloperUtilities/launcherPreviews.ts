/**
 * What each clipboard tool would answer, read with the shared adapters. The
 * clipboard text only passes through; a preview never quotes it back.
 */
import type { UtilitySuggestionId } from '../../clipboard/pasteHandlers';
import type { DeveloperUtilityId } from '../../data/developerUtilityCatalog';
import { formatNumber } from '../../i18n/formatNumber';
import { parseColorToRgb, rgbToHex } from '../../utils/developerUtilityDetection';
import { base64EncodeAdapter } from '../../../shared/utilities/base64';
import { hashAdapter } from '../../../shared/utilities/hash';
import { jwtDecodeAdapter } from '../../../shared/utilities/jwtDecode';
import { qrVersionAtM } from '../../../shared/utilities/qrCapacity';
import { inspect } from '../../../shared/utilities/stringInspect';
import { encodeUrlComponent } from '../../../shared/utilities/urlComponent';
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

/** First six and last four characters of a digest, as the board abbreviates hashes. */
function shortDigest(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
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

function urlPreview(text: string, t: Translate): LauncherPreview | null {
  let encoded: string;
  try {
    encoded = encodeUrlComponent(text);
  } catch {
    return null;
  }
  const escaped = encoded.split('%').length - 1;
  return escaped === 0
    ? { text: t('utilities.launcher.preview.noChange'), tone: 'none' }
    : { text: t('utilities.launcher.preview.escaped', { count: escaped }), tone: 'neutral' };
}

function qrPreview(text: string, t: Translate): LauncherPreview {
  const version = qrVersionAtM(text);
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
      return { text: hex, tone: 'neutral', swatch: hex };
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
    base64EncodeAdapter.run(text, {}),
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
