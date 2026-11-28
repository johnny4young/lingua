import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { qrVersionAtM } from '../../../src/shared/utilities/qrCapacity';

const encoderVersion = (text: string) => QRCode.create(text, { errorCorrectionLevel: 'M' }).version;

describe('qrVersionAtM', () => {
  it.each([
    ['numeric', '7'],
    ['alphanumeric', 'A'],
    ['byte', 'a'],
  ])('matches the QR encoder at each %s capacity edge', (_mode, unit) => {
    let length = 1;
    for (let version = 1; version <= 40; version += 1) {
      while (qrVersionAtM(unit.repeat(length + 1)) === version) length += 1;
      expect(encoderVersion(unit.repeat(length))).toBe(version);
      if (version < 40) expect(encoderVersion(unit.repeat(length + 1))).toBe(version + 1);
    }
  });

  it('counts UTF-8 bytes and reads JWTs in byte mode', () => {
    expect(qrVersionAtM('é'.repeat(7))).toBe(1);
    expect(qrVersionAtM('é'.repeat(8))).toBe(2);
    expect(qrVersionAtM('e'.repeat(169))).toBe(9);
  });

  it('has no version for empty text or text past version 40', () => {
    expect(qrVersionAtM('')).toBeNull();
    expect(qrVersionAtM('a'.repeat(2332))).toBeNull();
    expect(qrVersionAtM('a'.repeat(2331))).toBe(40);
  });
});
