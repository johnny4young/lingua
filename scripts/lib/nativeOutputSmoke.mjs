import assert from 'node:assert/strict';

export const nativeOutputCap = 1024 * 1024;
const unit = '漢😀';
const copies = Math.ceil(nativeOutputCap / Buffer.byteLength(unit)) + 1;

/** Finite harmless output; the Stop fixture then waits without extra output. */
export function unicodeFixture(waitForStop) {
  return `
const text = ${JSON.stringify(unit)}.repeat(${copies});
process.stdout.write(text, () => {
  ${waitForStop
    ? 'process.stderr.write("READY\\n"); setInterval(() => {}, 1000);'
    : 'process.stderr.write(text);'}
});`;
}

/** Independent expectation: whole repeated units plus any fitting next code point. */
export function assertUnicodeCapture(result, streams = ['stdout', 'stderr']) {
  for (const stream of streams) {
    const marker = `\n[${stream} truncated]`;
    const room = nativeOutputCap - Buffer.byteLength(marker);
    const prefix = unit.repeat(Math.floor(room / 7)) + (room % 7 >= 3 ? '漢' : '');
    const value = result[stream];
    // Avoid megabyte diffs in failure logs.
    assert.equal(value === prefix + marker, true, `${stream} preserves the exact Unicode prefix and marker`);
    assert(Buffer.byteLength(value) <= nativeOutputCap, `${stream} fits its UTF-8 byte budget`);
    assert(!value.includes('\uFFFD'), `${stream} contains no replacement character`);
  }
}
