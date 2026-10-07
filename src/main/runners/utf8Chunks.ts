import { StringDecoder } from 'node:string_decoder';

/** Decodes piped chunks so a multi-byte character split across two chunks stays intact. */
export function createUtf8ChunkDecoder(): (chunk: Buffer | string) => string {
  const decoder = new StringDecoder('utf8');
  return chunk => (typeof chunk === 'string' ? chunk : decoder.write(chunk));
}
