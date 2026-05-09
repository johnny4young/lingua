/**
 * Go WASM execution Web Worker.
 *
 * Receives compiled WASM bytes + wasm_exec.js, instantiates and runs the Go program.
 * Captures stdout/stderr by patching the Go globalThis.fs polyfill.
 */

declare function importScripts(...urls: string[]): void;

{
  const ctx = self as unknown as Worker;

  ctx.addEventListener('message', async (event) => {
    const msg = event.data;

    if (msg.type === 'execute') {
      const { runId, wasmBytes, wasmExecJs, timeout } = msg;
      const startTime = performance.now();

      try {
        // Load wasm_exec.js via a Blob URL (avoids direct eval)
        const blob = new Blob([wasmExecJs], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        importScripts(blobUrl);
        URL.revokeObjectURL(blobUrl);

        const go = new Go();

        // Capture stdout/stderr via the Go fs write polyfill
        const decoder = new TextDecoder();
        let stdoutBuffer = '';
        let stderrBuffer = '';

        // Override the writeSync used by Go's wasm_exec.js
        const originalWriteSync = globalThis.fs.writeSync;
        globalThis.fs.writeSync = (fd: number, buf: Uint8Array) => {
          const text = decoder.decode(buf);
          if (fd === 1) {
            // stdout
            stdoutBuffer += text;
            // Flush on newlines
            const lines = stdoutBuffer.split('\n');
            for (let i = 0; i < lines.length - 1; i++) {
              const line = lines[i];
              if (line && line.length > 0) {
                ctx.postMessage({ type: 'console', runId, method: 'log', args: [line] });
              }
            }
            stdoutBuffer = lines.at(-1) ?? '';
          } else if (fd === 2) {
            // stderr
            stderrBuffer += text;
            const lines = stderrBuffer.split('\n');
            for (let i = 0; i < lines.length - 1; i++) {
              const line = lines[i];
              if (line && line.length > 0) {
                ctx.postMessage({ type: 'console', runId, method: 'error', args: [line] });
              }
            }
            stderrBuffer = lines.at(-1) ?? '';
          } else {
            return originalWriteSync(fd, buf);
          }
          return buf.length;
        };

        // Compile and instantiate the WASM module
        // Two-step avoids the BufferSource vs Module overload ambiguity in TypeScript
        const wasmBuffer = new Uint8Array(wasmBytes);
        const wasmModule = await WebAssembly.compile(wasmBuffer);
        const wasmInstance = await WebAssembly.instantiate(wasmModule, go.importObject);

        // Set up timeout
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          ctx.postMessage({
            type: 'error',
            runId,
            error: { message: `Execution timed out after ${timeout / 1000}s` },
          });
          ctx.postMessage({
            type: 'done',
            runId,
            executionTime: performance.now() - startTime,
          });
        }, timeout);

        // Run the Go program
        await go.run(wasmInstance);

        clearTimeout(timeoutId);

        if (timedOut) return;

        // Flush remaining buffers
        if (stdoutBuffer.length > 0) {
          ctx.postMessage({ type: 'console', runId, method: 'log', args: [stdoutBuffer] });
        }
        if (stderrBuffer.length > 0) {
          ctx.postMessage({ type: 'console', runId, method: 'error', args: [stderrBuffer] });
        }

        ctx.postMessage({
          type: 'done',
          runId,
          executionTime: performance.now() - startTime,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.postMessage({
          type: 'error',
          runId,
          error: { message },
        });
        ctx.postMessage({
          type: 'done',
          runId,
          executionTime: performance.now() - startTime,
        });
      }
    }
  });
}
