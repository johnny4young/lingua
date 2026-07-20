/**
 * internal — lazy `monaco-vim` loader, shared by the main code editor and
 * (implementation Slice Monaco-cells implementation note) the notebook cell editor.
 *
 * The chunk is fetched at most once per session — even rapid toggle on /
 * off cycles, and concurrent callers across surfaces, share the same
 * in-flight promise. Failures fall through to `null` so each caller's gate
 * simply skips the init call instead of bricking the editor; the user can
 * re-flip the toggle to retry.
 */

export type MonacoVimModule = typeof import('monaco-vim');
export type VimAdapter = ReturnType<MonacoVimModule['initVimMode']>;

let monacoVimPromise: Promise<MonacoVimModule | null> | null = null;

export function loadMonacoVim(): Promise<MonacoVimModule | null> {
  if (monacoVimPromise) return monacoVimPromise;
  monacoVimPromise = import('monaco-vim').catch((error: unknown) => {
    console.warn('Failed to load monaco-vim chunk', error);
    monacoVimPromise = null;
    return null;
  });
  return monacoVimPromise;
}
