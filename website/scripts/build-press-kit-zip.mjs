#!/usr/bin/env node
/**
 * Bundle public/press/* into public/press/lingua-press-kit.zip.
 * Runs as `prebuild` so the ZIP is part of the static deploy.
 *
 * Uses Node's built-in zlib/deflate to avoid an extra dependency.
 * Implementation is a minimal ZIP writer that handles the small file
 * count we ship at launch.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESS_DIR = resolve(__dirname, '..', 'public', 'press');
const ZIP_PATH = join(PRESS_DIR, 'lingua-press-kit.zip');

async function walk(dir) {
  const entries = [];
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  for (const ent of dirents) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      entries.push(...(await walk(full)));
    } else if (ent.isFile() && full !== ZIP_PATH) {
      entries.push(full);
    }
  }
  return entries;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

async function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosTime();

  for (const file of files) {
    const data = await readFile(file.absPath);
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const crc = crc32(data);
    const nameBuf = Buffer.from(file.name, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                // version
    local.writeUInt16LE(0x0800, 6);            // utf-8 flag
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); // method
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);   // compressed size
    local.writeUInt32LE(data.length, 22);      // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);                // extra
    nameBuf.copy(local, 30);
    localParts.push(local, payload);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);              // version made by
    central.writeUInt16LE(20, 6);              // version needed
    central.writeUInt16LE(0x0800, 8);          // utf-8 flag
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);              // extra
    central.writeUInt16LE(0, 32);              // comment
    central.writeUInt16LE(0, 34);              // disk
    central.writeUInt16LE(0, 36);              // internal
    central.writeUInt32LE(0, 38);              // external
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += local.length + payload.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

async function main() {
  await mkdir(PRESS_DIR, { recursive: true });
  const filePaths = await walk(PRESS_DIR);
  if (filePaths.length === 0) {
    console.warn('[press-kit] No files in public/press/. Writing empty placeholder ZIP.');
  }

  const files = filePaths.map((absPath) => ({
    absPath,
    name: relative(PRESS_DIR, absPath).split(sep).join('/'),
  }));

  const zip = await buildZip(files);
  await writeFile(ZIP_PATH, zip);
  console.log(`[press-kit] ${files.length} file(s) → ${relative(process.cwd(), ZIP_PATH)} (${zip.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error('[press-kit] failed:', err);
  process.exit(1);
});
