/**
 * Ambient type declarations for Go WASM runtime globals.
 * These are injected into the Worker's global scope by wasm_exec.js.
 */

/** The Go class provided by wasm_exec.js */
declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

/** Go's fs polyfill patched onto globalThis by wasm_exec.js */
declare namespace globalThis {
  interface GoWasmFs {
    writeSync(fd: number, buf: Uint8Array): number;
  }
  // eslint-disable-next-line no-var
  var fs: GoWasmFs;
}
