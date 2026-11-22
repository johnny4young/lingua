import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ShieldCheck, Square } from 'lucide-react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ProjectTerminalBinding } from '../../stores/projectTerminalStore';
import { useProjectTerminalStore } from '../../stores/projectTerminalStore';

interface ProjectTerminalPanelProps {
  readonly binding: ProjectTerminalBinding;
  /** Take keyboard focus; false while Terminal only sits beside Tests. */
  readonly autoFocus?: boolean;
}

const INITIAL_COLUMNS = 100;
const INITIAL_ROWS = 30;

export function ProjectTerminalPanel({ binding, autoFocus = true }: ProjectTerminalPanelProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const autoFocusRef = useRef(autoFocus);
  const lastSequenceRef = useRef(0);
  const status = useProjectTerminalStore(state => state.status);
  const rootId = useProjectTerminalStore(state => state.rootId);
  const shellName = useProjectTerminalStore(state => state.shellName);
  const chunks = useProjectTerminalStore(state => state.chunks);
  const exit = useProjectTerminalStore(state => state.exit);
  const error = useProjectTerminalStore(state => state.error);
  const start = useProjectTerminalStore(state => state.start);
  const write = useProjectTerminalStore(state => state.write);
  const resize = useProjectTerminalStore(state => state.resize);
  const stop = useProjectTerminalStore(state => state.stop);
  const clearBuffer = useProjectTerminalStore(state => state.clearBuffer);
  const reset = useProjectTerminalStore(state => state.reset);

  useEffect(() => {
    if (rootId !== binding.rootId) reset(binding);
  }, [binding, reset, rootId]);

  const handleStart = useCallback(() => {
    void start(binding, INITIAL_COLUMNS, INITIAL_ROWS);
  }, [binding, start]);

  const handleRestart = useCallback(async () => {
    await stop();
    reset(binding);
    await useProjectTerminalStore
      .getState()
      .start(binding, INITIAL_COLUMNS, INITIAL_ROWS);
  }, [binding, reset, stop]);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
    clearBuffer();
    lastSequenceRef.current = 0;
  }, [clearBuffer]);

  useEffect(() => {
    if ((status !== 'running' && status !== 'exited') || !containerRef.current) return;
    const container = containerRef.current;
    const terminal = new XtermTerminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5_000,
      theme: {
        background: '#070a0b',
        foreground: '#d7e0df',
        cursor: '#5eead4',
        cursorAccent: '#070a0b',
        selectionBackground: '#164e63',
        black: '#111827',
        red: '#fb7185',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#6b7280',
        brightRed: '#fda4af',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f9fafb',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    const snapshot = useProjectTerminalStore.getState().chunks;
    for (const chunk of snapshot) terminal.write(chunk.data);
    lastSequenceRef.current = snapshot.at(-1)?.sequence ?? 0;
    const input = terminal.onData(data => {
      if (useProjectTerminalStore.getState().status === 'running') write(data);
    });

    const fit = () => {
      if (!container.isConnected) return;
      try {
        fitAddon.fit();
        resize(terminal.cols, terminal.rows);
      } catch {
        // The drawer can be between layout frames while it is resized.
      }
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(container);
    requestAnimationFrame(() => {
      fit();
      if (autoFocusRef.current) terminal.focus();
    });
    return () => {
      observer.disconnect();
      input.dispose();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [resize, status, write]);

  useEffect(() => {
    autoFocusRef.current = autoFocus;
    if (autoFocus) terminalRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    for (const chunk of chunks) {
      if (chunk.sequence > lastSequenceRef.current) terminal.write(chunk.data);
    }
    lastSequenceRef.current = Math.max(
      lastSequenceRef.current,
      chunks.at(-1)?.sequence ?? 0
    );
  }, [chunks]);

  if (status === 'idle' || status === 'unavailable' || status === 'error') {
    return (
      <div
        data-testid="project-terminal-empty"
        className="flex h-full min-h-0 items-center justify-center overflow-auto p-5"
      >
        <div className="surface-panel w-full max-w-2xl p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <ShieldCheck size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-eyebrow font-bold uppercase tracking-[0.14em] text-primary">
                {t('projectTerminal.eyebrow')}
              </p>
              <h3 className="mt-1 font-display text-h3 font-semibold text-foreground">
                {t('projectTerminal.title', { project: binding.projectName })}
              </h3>
              <p className="mt-2 max-w-xl text-body leading-6 text-muted">
                {t('projectTerminal.description')}
              </p>
              <p className="mt-3 rounded-lg border border-warning-border/60 bg-warning-bg px-3 py-2 text-caption leading-5 text-warning-fg">
                {t('projectTerminal.trustBoundary')}
              </p>
              {status === 'unavailable' ? (
                <p className="mt-3 text-caption text-muted">
                  {t('projectTerminal.unavailable')}
                </p>
              ) : status === 'error' && error ? (
                <p role="alert" className="mt-3 text-caption text-danger">
                  {t(`projectTerminal.errors.${error}`)}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleStart}
                disabled={status === 'unavailable'}
                data-testid="project-terminal-start"
                className="button-primary mt-4 inline-flex items-center gap-2"
              >
                <Play size={12} aria-hidden="true" />
                {t('projectTerminal.start')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={t('projectTerminal.panelLabel')}
      data-testid="project-terminal-panel"
      className="flex h-full min-h-0 flex-col bg-[#070a0b]"
    >
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2.5 bg-bg-inset px-4 text-caption">
        <h3 className="min-w-0 truncate text-eyebrow font-semibold uppercase tracking-[0.09em] text-fg-subtle">
          {t('projectTerminal.title', { project: binding.projectName })}
        </h3>
        <span
          data-testid="project-terminal-status"
          className={`shrink-0 ${status === 'running' ? 'text-success-fg' : 'text-fg-muted'}`}
        >
          {status === 'starting'
            ? t('projectTerminal.status.starting')
            : status === 'running'
              ? t('projectTerminal.status.running', { shell: shellName ?? '' })
              : t('projectTerminal.status.exited', {
                  code: exit?.exitCode ?? '—',
                })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 text-fg-muted">
          {status === 'running' ? (
            <button
              type="button"
              onClick={() => void stop()}
              aria-label={t('projectTerminal.stop')}
              title={t('projectTerminal.stop')}
              className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded hover:bg-bg-panel-alt hover:text-error-fg"
              data-testid="project-terminal-stop"
            >
              <Square size={10} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleRestart()}
            disabled={status === 'starting'}
            className="focus-ring h-6 rounded px-1.5 hover:bg-bg-panel-alt hover:text-fg-base disabled:opacity-50"
            data-testid="project-terminal-restart"
          >
            {t('projectTerminal.restart')}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="focus-ring h-6 rounded px-1.5 hover:bg-bg-panel-alt hover:text-fg-base"
            data-testid="project-terminal-clear"
          >
            {t('projectTerminal.clear')}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        data-testid="project-terminal-xterm"
        className="min-h-0 flex-1 overflow-hidden px-2 py-1.5"
      />
    </section>
  );
}
