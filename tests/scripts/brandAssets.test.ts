import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ICNS_ARGB_TYPES,
  ICNS_TYPES,
  ICO_SIZES,
  appIconSvg,
  driftedSvgs,
  encodeIco,
  packBits,
  wordmarkGeometry,
} from '../../scripts/brand/generate-brand-assets.mjs';
import { en } from '../../website/src/i18n/en';
import { es } from '../../website/src/i18n/es';
import { SITE } from '../../website/src/lib/site';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file));
const text = (file: string) => read(file).toString('utf8');

function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function icnsEntries(icns: Buffer): Map<string, Buffer> {
  expect(icns.subarray(0, 4).toString('latin1')).toBe('icns');
  expect(icns.readUInt32BE(4)).toBe(icns.length);
  const entries = new Map<string, Buffer>();
  for (let offset = 8; offset < icns.length; ) {
    const length = icns.readUInt32BE(offset + 4);
    entries.set(icns.subarray(offset, offset + 4).toString('latin1'), icns.subarray(offset + 8, offset + length));
    offset += length;
  }
  return entries;
}

function unpackBits(packed: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < packed.length; ) {
    const control = packed[i]!;
    if (control < 128) {
      out.push(...packed.subarray(i + 1, i + 2 + control));
      i += control + 2;
    } else {
      out.push(...Array<number>(control - 125).fill(packed[i + 1]!));
      i += 2;
    }
  }
  return out;
}

function icoEntries(ico: Buffer): Array<[number, Buffer]> {
  expect(ico.readUInt16LE(2)).toBe(1);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16;
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return [ico.readUInt8(entry) || 256, ico.subarray(offset, offset + size)];
  });
}

describe('brand assets', () => {
  it('keeps every committed SVG in sync with the generator', async () => {
    expect(await driftedSvgs()).toEqual([]);
  });

  it('keeps the electron-builder icon paths on the regenerated files', () => {
    const builder = text('electron-builder.yml');
    for (const icon of ['assets/icon.icns', 'assets/icon.ico', 'assets/icon.png']) {
      expect(builder).toContain(`icon: ${icon}`);
      expect(existsSync(path.join(root, icon))).toBe(true);
    }
    expect(pngSize(read('assets/icon.png'))).toEqual([1024, 1024]);
  });

  it('packs the macOS sizes 16-1024 with @2x into icon.icns', () => {
    const entries = icnsEntries(read('assets/icon.icns'));
    expect([...entries.keys()]).toEqual(ICNS_TYPES.map(([type]) => type));
    for (const [type, px] of ICNS_TYPES) {
      const payload = entries.get(type)!;
      if (ICNS_ARGB_TYPES.has(type)) {
        expect(payload.subarray(0, 4).toString('latin1')).toBe('ARGB');
        expect(unpackBits(payload.subarray(4))).toHaveLength(px * px * 4);
      } else {
        expect(pngSize(payload)).toEqual([px, px]);
      }
    }
  });

  it('round-trips ICNS PackBits runs and literals', () => {
    const bytes = [...Array<number>(200).fill(7), 1, 2, 3, 3, 4, ...Array<number>(300).keys()].map(n => n % 256);
    expect(unpackBits(packBits(Uint8Array.from(bytes)))).toEqual(bytes);
  });

  it('packs the Windows sizes into icon.ico', () => {
    const entries = icoEntries(read('assets/icon.ico'));
    expect(entries.map(([px]) => px)).toEqual(ICO_SIZES);
    for (const [px, png] of entries) expect(pngSize(png)).toEqual([px, px]);
  });

  it('writes 256 px ICO entries as size 0', () => {
    const png = read('public/icon-192.png');
    const ico = encodeIco([[256, png]]);
    expect(ico.readUInt8(6)).toBe(0);
    expect(icoEntries(ico)[0]?.[1].equals(png)).toBe(true);
  });

  it('drops the leader for the lite mark and keeps it on the master', () => {
    const circles = (svg: string) => svg.match(/<circle /gu)?.length ?? 0;
    expect(circles(text('assets/icon.svg'))).toBe(4);
    expect(circles(text('public/favicon.svg'))).toBe(1);
    expect(text('website/public/favicon.svg')).toBe(text('public/favicon.svg'));
    expect(appIconSvg({ radius: 36 })).toContain('viewBox="0 0 160 160"');
  });

  it('ships outlined wordmarks with no live text', () => {
    for (const file of ['wordmark', 'wordmark-inverse', 'wordmark-mono', 'mark-mono']) {
      const svg = text(`assets/brand/${file}.svg`);
      expect(svg).not.toMatch(/<text|font-family/u);
      expect(svg).toMatch(/<path d="M/u);
    }
    expect(text('assets/brand/wordmark.svg')).toContain('fill="#00BFDF"');
    expect(text('website/scripts/og-wordmark.svg')).toBe(text('assets/brand/wordmark-inverse.svg'));
  });

  it('publishes the brand files in the website press kit', () => {
    // The SVG copies are covered by the drift check; the raster is not.
    expect(read('website/public/press/icon.png').equals(read('assets/icon.png'))).toBe(true);
    for (const file of SITE.press.assets) {
      expect(existsSync(path.join(root, 'website/public/press', file))).toBe(true);
      expect(en.press.assets.files[file]).toBeTruthy();
      expect(es.press.assets.files[file]).toBeTruthy();
      expect(text('website/public/press/README.txt')).toContain(file);
    }
  });

  it('sets the site header and footer with the outlined wordmark', () => {
    const site = text('website/src/assets/brand/wordmark.svg');
    const letters = (svg: string) => svg.match(/<path d="([^"]+)"/u)?.[1];
    expect(letters(site)).toBe(letters(text('assets/brand/wordmark.svg')));
    expect(site).toContain('fill="currentColor"');
    expect(site).toContain('fill="#00BFDF"');
    expect(site).not.toContain('<title>');
    // BrandLink sizes the SVG and its clear space from these em ratios.
    const { bounds, xHeight } = wordmarkGeometry();
    const brandLink = text('website/src/components/BrandLink.astro');
    expect(brandLink).toContain("from '~/assets/brand/wordmark.svg'");
    expect(brandLink).toContain(`* ${((bounds.maxY - bounds.minY) / 100).toFixed(3)})`);
    expect(brandLink).toContain(`* ${(xHeight / 200).toFixed(3)})`);
    for (const component of ['Header', 'Footer']) {
      const source = text(`website/src/components/${component}.astro`);
      expect(source).not.toContain('lucide:terminal');
      expect(source).toContain('<BrandLink ');
    }
  });

  it('sits the drawn dot 0.05 em above the x-height', () => {
    const { dot, xHeight } = wordmarkGeometry();
    expect(dot.r * 2).toBeCloseTo(17.5);
    expect(-dot.cy - dot.r - xHeight).toBeCloseTo(5);
  });

  it('lists a maskable 512 icon in the PWA manifest and keeps the tab icons', () => {
    const manifest = JSON.parse(text('public/manifest.json')) as {
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    const maskable = manifest.icons.find(icon => icon.purpose === 'maskable');
    expect(maskable).toMatchObject({ src: './icon-maskable-512.png', sizes: '512x512' });
    // The SVG is the lite mark, so larger launcher sizes must come from the full-mark PNGs.
    expect(manifest.icons.find(icon => icon.src === './favicon.svg')?.sizes).toBe('32x32');
    for (const icon of manifest.icons) expect(existsSync(path.join(root, 'public', icon.src))).toBe(true);
    for (const file of ['public/icon-192.png', 'public/icon-512.png', 'public/icon-maskable-512.png']) {
      const px = Number(file.match(/(\d+)\.png$/u)?.[1]);
      expect(pngSize(read(file))).toEqual([px, px]);
    }
    expect(text('index.html')).toContain('href="/favicon.svg"');
    expect(text('src/web/index.html')).toContain('href="%BASE_URL%favicon.svg"');
    expect(text('website/src/layouts/Base.astro')).toContain('href="/favicon.svg"');
  });
});
