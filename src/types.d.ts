declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}

interface GoDetectResult {
  installed: boolean;
  version?: string;
  goRoot?: string;
  error?: string;
}

interface GoCompileResult {
  success: boolean;
  wasmBytes?: number[];
  wasmExecJs?: string;
  error?: string;
  goVersion?: string;
}

interface RunLangAPI {
  platform: string;
  go: {
    detect: () => Promise<GoDetectResult>;
    compile: (sourceCode: string) => Promise<GoCompileResult>;
  };
}

// Augment Window with RunLang API
interface Window {
  runlang: RunLangAPI;
}

