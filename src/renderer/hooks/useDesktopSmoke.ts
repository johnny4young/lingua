import { useEffect, useRef } from 'react';
import { executeTabManually } from '../runtime/executeTabManually';
import { useConsoleStore } from '../stores/consoleStore';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import type { BuiltInLanguage, FileTab } from '../types';
import { extensionForLanguage } from '../utils/languageMeta';
import { desktopSmokeApi } from '../utils/desktopSmoke';

/**
 * RL-078 timeout-shaped smoke cases set `expectFailure` so the
 * harness inverts the verification logic: success == the runner
 * surfaced an error whose message matches `expectFailure` (the
 * localized timeout string in either EN or ES). `runnerTimeoutMs`
 * threads through `executeTabManually` to the runner's parent kill
 * timer so the test runs in seconds instead of the language default.
 */
type SmokeCase = {
  caseId: string;
  language: BuiltInLanguage;
  fileName: string;
  content: string;
  expectText?: string;
  expectFailure?: RegExp;
  /**
   * RL-079 — substring whose presence in any captured console entry
   * fails the case. Used by the env-isolation smokes to assert that
   * a sentinel secret seeded into `process.env` did NOT leak through
   * the env builder into the spawned subprocess.
   */
  forbidText?: string;
  /** Wall-clock budget on the entire `executeTabManually` round trip. */
  timeoutMs?: number;
  /** Override the runner's parent-side deadline. */
  runnerTimeoutMs?: number;
};

const SMOKE_CASES: SmokeCase[] = [
  {
    caseId: 'javascript',
    language: 'javascript',
    fileName: 'smoke-javascript.js',
    content: 'console.log("smoke-javascript");\n',
    expectText: 'smoke-javascript',
  },
  {
    caseId: 'typescript',
    language: 'typescript',
    fileName: 'smoke-typescript.ts',
    content: 'const label: string = "smoke-typescript";\nconsole.log(label);\n',
    expectText: 'smoke-typescript',
  },
  {
    caseId: 'python',
    language: 'python',
    fileName: 'smoke-python.py',
    content: 'print("smoke-python")\n',
    expectText: 'smoke-python',
    timeoutMs: 120_000,
  },
  {
    caseId: 'go',
    language: 'go',
    fileName: 'smoke-go.go',
    content:
      'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("smoke-go")\n}\n',
    expectText: 'smoke-go',
  },
  {
    caseId: 'rust',
    language: 'rust',
    fileName: 'smoke-rust.rs',
    content: 'fn main() {\n    println!("smoke-rust");\n}\n',
    expectText: 'smoke-rust',
  },
  // RL-078 — verify the parent kill timer terminates a CPU-bound
  // worker in JS and Python. Keep budgets tight so the smoke runner
  // does not balloon by 90 s.
  {
    caseId: 'javascript-timeout',
    language: 'javascript',
    fileName: 'smoke-javascript-timeout.js',
    content: 'while (true) {}\n',
    expectFailure: /timed out|excedi[oó]/i,
    runnerTimeoutMs: 3_000,
    timeoutMs: 12_000,
  },
  {
    caseId: 'python-timeout',
    language: 'python',
    fileName: 'smoke-python-timeout.py',
    content: 'while True:\n    pass\n',
    expectFailure: /timed out|excedi[oó]/i,
    runnerTimeoutMs: 3_000,
    timeoutMs: 20_000,
  },
  // RL-079 — verify the env-leak gate end-to-end with a real
  // subprocess. `scripts/run-desktop-smoke.mjs` seeds
  // `LINGUA_SMOKE_SECRET=__lingua_smoke_secret__` into the spawned
  // Electron's env. The smoke case prints `LINGUA_SMOKE_SECRET`; the
  // assertion below requires the captured stdout to NOT contain the
  // secret (i.e. `buildNativeRunnerEnv` filtered it out).
  {
    caseId: 'go-env-isolation',
    language: 'go',
    fileName: 'smoke-go-env-isolation.go',
    content:
      'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Println("ENV:", os.Getenv("LINGUA_SMOKE_SECRET"))\n}\n',
    forbidText: '__lingua_smoke_secret__',
    expectText: 'ENV:',
  },
  {
    caseId: 'rust-env-isolation',
    language: 'rust',
    fileName: 'smoke-rust-env-isolation.rs',
    content:
      'fn main() {\n    println!("ENV: {}", std::env::var("LINGUA_SMOKE_SECRET").unwrap_or_default());\n}\n',
    forbidText: '__lingua_smoke_secret__',
    expectText: 'ENV:',
  },
];

interface SmokeCaseSummary {
  caseId: string;
  language: BuiltInLanguage;
  ok: boolean;
  message: string;
  executionTime: number | null;
  screenshotPath: string | null;
}

interface SmokeProgressArtifact {
  generatedAt: string;
  status: 'started' | 'running-case' | 'completed' | 'failed';
  currentLanguage?: BuiltInLanguage;
  currentCaseId?: string;
  completedLanguages?: BuiltInLanguage[];
  completedCaseIds?: string[];
  error?: string;
}

const DEFAULT_CASE_TIMEOUT_MS = 35_000;

function waitForUi(ms = 220): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createSmokeTab(language: BuiltInLanguage, fileName: string, content: string): FileTab {
  const tab = createDefaultTab(language);
  return {
    ...tab,
    name: fileName || `smoke.${extensionForLanguage(language)}`,
    content,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export function useDesktopSmoke(enabled: boolean) {
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    const runSmoke = async () => {
      const api = desktopSmokeApi();
      if (!api) {
        return;
      }

      const config = await api.getConfig();
      if (!config?.enabled) {
        return;
      }

      const summaries: SmokeCaseSummary[] = [];

      try {
        await api.writeJsonArtifact('desktop-smoke-bootstrap.json', {
          generatedAt: new Date().toISOString(),
          status: 'started',
        });
        await api.writeJsonArtifact('desktop-smoke-progress.json', {
          generatedAt: new Date().toISOString(),
          status: 'started',
          completedLanguages: [],
        } satisfies SmokeProgressArtifact);

        useSettingsStore.setState({
          layoutPreset: 'horizontal',
          // RL-078 timeout cases need the parent kill timer, not loop guards, to own termination.
          loopProtection: false,
          // RL-079 — pre-acknowledge native execution so the trust
          // modal never blocks the smoke runner. The acknowledgement
          // exists explicitly to require the user's intent, but the
          // smoke is automation, not a human.
          nativeExecutionAcknowledged: true,
        });
        useUIStore.setState({
          sidebarVisible: false,
          consoleVisible: true,
        });

        for (const smokeCase of SMOKE_CASES) {
          await api.writeJsonArtifact('desktop-smoke-progress.json', {
            generatedAt: new Date().toISOString(),
            status: 'running-case',
            currentLanguage: smokeCase.language,
            currentCaseId: smokeCase.caseId,
            completedLanguages: summaries.map((summary) => summary.language),
            completedCaseIds: summaries.map((summary) => summary.caseId),
          } satisfies SmokeProgressArtifact);

          useConsoleStore.getState().clear();
          useResultStore.getState().clear();
          useEditorStore.setState({ tabs: [], activeTabId: null });

          const tab = createSmokeTab(smokeCase.language, smokeCase.fileName, smokeCase.content);
          const { addTab } = useEditorStore.getState();
          addTab(tab);

          await waitForUi();
          const execution = await withTimeout(
            executeTabManually(tab, {
              executionTimeoutMs: smokeCase.runnerTimeoutMs,
            }),
            smokeCase.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
            `${smokeCase.caseId} smoke execution`
          );
          await waitForUi();

          const screenshotPath = await withTimeout(
            api.capture(`desktop-smoke-${smokeCase.caseId}`),
            10_000,
            `${smokeCase.caseId} smoke screenshot capture`
          );

          let ok: boolean;
          let message: string;
          if (smokeCase.expectFailure) {
            // Timeout-shaped case: the runner must report an error
            // whose message matches the regex (covers both EN and
            // ES copies) and the synthetic `executionTime` set by
            // `runnerTimeoutResult` must equal the configured
            // deadline. A real `done` reply would carry the actual
            // runtime instead, which is the negative signal we use
            // to detect that the parent kill timer never fired.
            const matches =
              !execution.ok &&
              smokeCase.expectFailure.test(execution.message);
            const expectedDeadline =
              smokeCase.runnerTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
            const killedByParent =
              execution.executionTime === null ||
              execution.executionTime <= expectedDeadline;
            ok = matches && killedByParent;
            message = ok
              ? `Captured ${smokeCase.caseId} timeout error`
              : !matches
                ? `Expected timeout-shaped error, got: ${execution.message}`
                : `Timeout case did not match parent kill timer (executionTime=${execution.executionTime}ms vs expected ${expectedDeadline}ms)`;
          } else {
            const consoleEntries = useConsoleStore.getState().entries;
            const sawExpectedOutput = consoleEntries.some((entry) =>
              smokeCase.expectText
                ? entry.content.includes(smokeCase.expectText)
                : false
            );
            // RL-079 — env-isolation gate: a sentinel secret must NOT
            // appear anywhere in captured console output.
            const leakedForbidden =
              smokeCase.forbidText !== undefined &&
              consoleEntries.some((entry) =>
                entry.content.includes(smokeCase.forbidText!)
              );
            ok = execution.ok && sawExpectedOutput && !leakedForbidden;
            message = ok
              ? `Captured ${smokeCase.caseId} smoke output`
              : leakedForbidden
                ? `${smokeCase.caseId} leaked sentinel secret into stdout`
                : execution.ok
                  ? `Expected output "${smokeCase.expectText ?? ''}" was missing from the console`
                  : execution.message;
          }

          summaries.push({
            caseId: smokeCase.caseId,
            language: smokeCase.language,
            ok,
            message,
            executionTime: execution.executionTime,
            screenshotPath,
          });
        }

        const success = summaries.every((summary) => summary.ok);
        await api.writeJsonArtifact('desktop-smoke-progress.json', {
          generatedAt: new Date().toISOString(),
          status: 'completed',
          completedLanguages: summaries.map((summary) => summary.language),
          completedCaseIds: summaries.map((summary) => summary.caseId),
        } satisfies SmokeProgressArtifact);
        await api.writeJsonArtifact('desktop-smoke-summary.json', {
          generatedAt: new Date().toISOString(),
          artifactDir: config.artifactDir,
          cases: summaries,
        });
        api.finish(success);
      } catch (error) {
        await api.writeJsonArtifact('desktop-smoke-progress.json', {
          generatedAt: new Date().toISOString(),
          status: 'failed',
          completedLanguages: summaries.map((summary) => summary.language),
          completedCaseIds: summaries.map((summary) => summary.caseId),
          error: error instanceof Error ? error.message : String(error),
        } satisfies SmokeProgressArtifact);
        await api.writeJsonArtifact('desktop-smoke-summary.json', {
          generatedAt: new Date().toISOString(),
          artifactDir: config.artifactDir,
          cases: summaries,
          error: error instanceof Error ? error.message : String(error),
        });
        api.finish(false);
      }
    };

    void runSmoke();
  }, [enabled]);
}
