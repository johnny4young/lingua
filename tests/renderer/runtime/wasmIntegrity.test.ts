// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  compileWasmStreamingVerified,
  sha256HexOfStream,
  sha256HexToBytes,
  sha256HexToIntegrity,
} from '../../../src/renderer/runtime/wasmIntegrity';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

describe('sha256HexToIntegrity', () => {
  it('produces the SRI metadata browsers expect for a hex digest', () => {
    // Known vector: sha256 of the empty payload.
    expect(sha256HexToIntegrity(EMPTY_SHA256)).toBe(
      'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
    );
  });

  it('accepts uppercase hex and rejects anything that is not 64 hex chars', () => {
    expect(sha256HexToIntegrity(EMPTY_SHA256.toUpperCase())).toBe(
      sha256HexToIntegrity(EMPTY_SHA256)
    );
    expect(() => sha256HexToBytes('abc')).toThrow(/64-character hex/);
    expect(() => sha256HexToBytes(`${EMPTY_SHA256.slice(0, 62)}zz`)).toThrow(/64-character hex/);
  });
});

describe('sha256HexOfStream', () => {
  it('digests across chunk boundaries', async () => {
    await expect(sha256HexOfStream(streamOf('a', 'b', 'c'))).resolves.toBe(ABC_SHA256);
    await expect(sha256HexOfStream(streamOf())).resolves.toBe(EMPTY_SHA256);
  });
});

describe('compileWasmStreamingVerified', () => {
  it('streams the same bytes into the compiler with a wasm content type and resolves on a matching digest', async () => {
    const seen: { contentType: string | null; body: string }[] = [];
    const compile = vi.fn(async (response: Response) => {
      seen.push({
        contentType: response.headers.get('content-type'),
        body: await drain(response),
      });
      return { compiled: true } as unknown as WebAssembly.Module;
    });
    const response = new Response(streamOf('ab', 'c'), {
      headers: { 'content-type': 'application/octet-stream' },
    });

    const module = await compileWasmStreamingVerified(response, ABC_SHA256, 'Ruby', compile);

    expect(module).toEqual({ compiled: true });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ contentType: 'application/wasm', body: 'abc' }]);
  });

  it('rejects a tampered payload even though it compiled, naming both hashes', async () => {
    const compile = vi.fn(async (response: Response) => {
      await drain(response);
      return { compiled: true } as unknown as WebAssembly.Module;
    });
    const response = new Response(streamOf('abd'));

    await expect(
      compileWasmStreamingVerified(response, ABC_SHA256, 'Ruby', compile)
    ).rejects.toThrow(
      new RegExp(`Ruby runtime integrity check failed: expected sha256 ${ABC_SHA256}, got [0-9a-f]{64}`)
    );
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('lets a digest mismatch win over a compiler failure', async () => {
    const compile = vi.fn(async () => {
      throw new Error('CompileError: bad magic');
    });
    await expect(
      compileWasmStreamingVerified(new Response(streamOf('nope')), ABC_SHA256, 'Ruby', compile)
    ).rejects.toThrow(/integrity check failed/);
  });

  it('surfaces the compiler failure when the digest matches', async () => {
    const compile = vi.fn(async (response: Response) => {
      await drain(response);
      throw new Error('CompileError: bad magic');
    });
    await expect(
      compileWasmStreamingVerified(new Response(streamOf('abc')), ABC_SHA256, 'Ruby', compile)
    ).rejects.toThrow(/bad magic/);
  });

  it('rejects a body-less response instead of trusting it', async () => {
    const compile = vi.fn();
    await expect(
      compileWasmStreamingVerified(new Response(null), ABC_SHA256, 'Ruby', compile)
    ).rejects.toThrow(/no body to verify/);
    expect(compile).not.toHaveBeenCalled();
  });
});

// Exercise the real compiler, not only injected stand-ins. Keep EOF under
// test control to prove that starting compilation cannot release a module.
describe('verified streaming compilation with native WebAssembly', () => {
  const wasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const wasmSha256 = '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476';

  it('starts compilation before EOF but releases the module only after verification', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    });
    const compile = vi.fn((response: Response) => WebAssembly.compileStreaming(response));
    let released = false;
    const pending = compileWasmStreamingVerified(new Response(stream), wasmSha256, 'Ruby', compile)
      .then(module => { released = true; return module; });
    controller.enqueue(wasm.subarray(0, 4));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(compile).toHaveBeenCalledTimes(1);
    expect(released).toBe(false);
    controller.enqueue(wasm.subarray(4));
    controller.close();
    expect(await pending).toBeInstanceOf(WebAssembly.Module);
  });

  it('rejects valid executable bytes with the wrong digest', async () => {
    await expect(compileWasmStreamingVerified(new Response(wasm), ABC_SHA256, 'Ruby'))
      .rejects.toThrow(/integrity check failed/);
  });

  it('rejects a download interrupted after the wasm header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(wasm.subarray(0, 4));
        controller.error(new Error('download interrupted'));
      },
    });
    await expect(compileWasmStreamingVerified(new Response(stream), wasmSha256, 'Ruby'))
      .rejects.toThrow(/download interrupted/);
  });
});
