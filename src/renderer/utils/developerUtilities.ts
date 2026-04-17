export interface JsonAnalysis {
  formatted: string | null;
  minified: string | null;
  parsed: unknown | null;
  errorKey: string | null;
}

export interface TransformResult {
  value: string | null;
  errorKey: string | null;
}

export interface JwtAnalysis {
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature: string | null;
  errorKey: string | null;
}

export interface TimestampAnalysis {
  unixSeconds: number | null;
  unixMilliseconds: number | null;
  iso: string | null;
  local: string | null;
  errorKey: string | null;
}

const INDENT_SIZE = 2;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - padding), '=');
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function analyzeJson(value: string): JsonAnalysis {
  if (!value.trim()) {
    return {
      formatted: null,
      minified: null,
      parsed: null,
      errorKey: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return {
      formatted: JSON.stringify(parsed, null, INDENT_SIZE),
      minified: JSON.stringify(parsed),
      parsed,
      errorKey: null,
    };
  } catch {
    return {
      formatted: null,
      minified: null,
      parsed: null,
      errorKey: 'utilities.tool.json.error',
    };
  }
}

export function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

export function decodeBase64(value: string): TransformResult {
  if (!value.trim()) {
    return {
      value: '',
      errorKey: null,
    };
  }

  try {
    const sanitized = value.replace(/\s+/gu, '');
    const bytes = base64ToBytes(sanitized);
    return {
      value: new TextDecoder().decode(bytes),
      errorKey: null,
    };
  } catch {
    return {
      value: null,
      errorKey: 'utilities.tool.base64.error',
    };
  }
}

export function encodeUrlComponentValue(value: string): string {
  return encodeURIComponent(value);
}

export function decodeUrlComponentValue(value: string): TransformResult {
  if (!value.trim()) {
    return {
      value: '',
      errorKey: null,
    };
  }

  try {
    return {
      value: decodeURIComponent(value),
      errorKey: null,
    };
  } catch {
    return {
      value: null,
      errorKey: 'utilities.tool.url.error',
    };
  }
}

export async function hashText(
  value: string,
  algorithm: 'SHA-1' | 'SHA-256'
): Promise<string> {
  const digest = await crypto.subtle.digest(
    algorithm,
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

export function decodeJwt(value: string): JwtAnalysis {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      header: null,
      payload: null,
      signature: null,
      errorKey: null,
    };
  }

  const [headerPart, payloadPart, signaturePart] = trimmed.split('.');
  if (!headerPart || !payloadPart) {
    return {
      header: null,
      payload: null,
      signature: null,
      errorKey: 'utilities.tool.jwt.errorSegments',
    };
  }

  try {
    const header = parseJsonObject(
      new TextDecoder().decode(base64ToBytes(normalizeBase64Url(headerPart)))
    );
    const payload = parseJsonObject(
      new TextDecoder().decode(base64ToBytes(normalizeBase64Url(payloadPart)))
    );

    if (!header || !payload) {
      return {
        header,
        payload,
        signature: signaturePart ?? null,
        errorKey: 'utilities.tool.jwt.errorObject',
      };
    }

    return {
      header,
      payload,
      signature: signaturePart ?? null,
      errorKey: null,
    };
  } catch {
    return {
      header: null,
      payload: null,
      signature: signaturePart ?? null,
      errorKey: 'utilities.tool.jwt.error',
    };
  }
}

export function analyzeTimestamp(value: string): TimestampAnalysis {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      unixSeconds: null,
      unixMilliseconds: null,
      iso: null,
      local: null,
      errorKey: null,
    };
  }

  let date: Date | null = null;

  if (/^-?\d+$/u.test(trimmed)) {
    const numeric = Number.parseInt(trimmed, 10);
    const milliseconds = trimmed.length <= 10 ? numeric * 1000 : numeric;
    date = new Date(milliseconds);
  } else {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return {
      unixSeconds: null,
      unixMilliseconds: null,
      iso: null,
      local: null,
      errorKey: 'utilities.tool.timestamp.error',
    };
  }

  const unixMilliseconds = date.getTime();

  return {
    unixSeconds: Math.floor(unixMilliseconds / 1000),
    unixMilliseconds,
    iso: date.toISOString(),
    local: date.toLocaleString(),
    errorKey: null,
  };
}
