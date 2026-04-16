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

const SMOKE_CASES: Array<{
  language: BuiltInLanguage;
  fileName: string;
  content: string;
  expectText: string;
}> = [
  {
    language: 'javascript',
    fileName: 'smoke-javascript.js',
    content: 'console.log("smoke-javascript");\n',
    expectText: 'smoke-javascript',
  },
  {
    language: 'typescript',
    fileName: 'smoke-typescript.ts',
    content: 'const label: string = "smoke-typescript";\nconsole.log(label);\n',
    expectText: 'smoke-typescript',
  },
  {
    language: 'python',
    fileName: 'smoke-python.py',
    content: 'print("smoke-python")\n',
    expectText: 'smoke-python',
  },
  {
    language: 'go',
    fileName: 'smoke-go.go',
    content:
      'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("smoke-go")\n}\n',
    expectText: 'smoke-go',
  },
  {
    language: 'rust',
    fileName: 'smoke-rust.rs',
    content: 'fn main() {\n    println!("smoke-rust");\n}\n',
    expectText: 'smoke-rust',
  },
];

interface SmokeCaseSummary {
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
  completedLanguages?: BuiltInLanguage[];
  error?: string;
}

const CASE_TIMEOUT_MS = 35_000;

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
        });
        useUIStore.setState({
          sidebarVisible: false,
          consoleVisible: true,
        });

        const summaries: SmokeCaseSummary[] = [];

        for (const smokeCase of SMOKE_CASES) {
          await api.writeJsonArtifact('desktop-smoke-progress.json', {
            generatedAt: new Date().toISOString(),
            status: 'running-case',
            currentLanguage: smokeCase.language,
            completedLanguages: summaries.map((summary) => summary.language),
          } satisfies SmokeProgressArtifact);

          useConsoleStore.getState().clear();
          useResultStore.getState().clear();
          useEditorStore.setState({ tabs: [], activeTabId: null });

          const tab = createSmokeTab(smokeCase.language, smokeCase.fileName, smokeCase.content);
          const { addTab } = useEditorStore.getState();
          addTab(tab);

          await waitForUi();
          const execution = await withTimeout(
            executeTabManually(tab),
            CASE_TIMEOUT_MS,
            `${smokeCase.language} smoke execution`
          );
          await waitForUi();

          const consoleEntries = useConsoleStore.getState().entries;
          const sawExpectedOutput = consoleEntries.some((entry) =>
            entry.content.includes(smokeCase.expectText)
          );

          const screenshotPath = await withTimeout(
            api.capture(`desktop-smoke-${smokeCase.language}`),
            10_000,
            `${smokeCase.language} smoke screenshot capture`
          );
          const ok = execution.ok && sawExpectedOutput;
          summaries.push({
            language: smokeCase.language,
            ok,
            message: ok
              ? `Captured ${smokeCase.language} smoke output`
              : execution.ok
                ? `Expected output "${smokeCase.expectText}" was missing from the console`
                : execution.message,
            executionTime: execution.executionTime,
            screenshotPath,
          });
        }

        const success = summaries.every((summary) => summary.ok);
        await api.writeJsonArtifact('desktop-smoke-progress.json', {
          generatedAt: new Date().toISOString(),
          status: 'completed',
          completedLanguages: summaries.map((summary) => summary.language),
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
          error: error instanceof Error ? error.message : String(error),
        } satisfies SmokeProgressArtifact);
        await api.writeJsonArtifact('desktop-smoke-summary.json', {
          generatedAt: new Date().toISOString(),
          artifactDir: config.artifactDir,
          cases: [],
          error: error instanceof Error ? error.message : String(error),
        });
        api.finish(false);
      }
    };

    void runSmoke();
  }, [enabled]);
}
