import { segmentBytes } from '../toolAnswers';

export type JwtSignatureState = 'missing' | 'unverified' | 'verified' | 'failed' | 'signed';

/** Segment colours shared by the token overlay, the header bar and the section swatches. */
export const JWT_HEADER_COLOR = 'var(--color-value-boolean)';
export const JWT_PAYLOAD_COLOR = 'var(--color-value-number)';

export function jwtSignatureColor(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
    case 'signed':
      return 'var(--color-success-fg)';
    case 'failed':
      return 'var(--color-value-error)';
    case 'missing':
    case 'unverified':
      return 'var(--color-value-none)';
  }
}

/** A signature-less token resolves to `missing`: you cannot verify what is not there. */
export function resolveSignatureState(token: string, base: JwtSignatureState): JwtSignatureState {
  const parts = token.trim().split('.');
  const signature = parts.slice(2).join('.');
  return signature ? base : 'missing';
}

export function signatureStatusLabelKey(state: JwtSignatureState): string {
  switch (state) {
    case 'verified':
      return 'utilities.jwtPreview.signature.verified';
    case 'failed':
      return 'utilities.jwtPreview.signature.failed';
    case 'signed':
      return 'utilities.jwtPreview.signature.signed';
    case 'missing':
      return 'utilities.jwtPreview.signature.missing';
    case 'unverified':
      return 'utilities.jwtPreview.signature.unverified';
  }
}

/** Each part of a token by its decoded size, in the order it is written. */
export interface JwtSegmentBytes {
  header: number;
  payload: number;
  signature: number;
}

export function jwtSegmentBytes(token: string): JwtSegmentBytes {
  const [header = '', payload = '', ...signature] = token.trim().split('.');
  return { header: segmentBytes(header), payload: segmentBytes(payload), signature: segmentBytes(signature.join('.')) };
}

