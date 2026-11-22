/**
 * Acceptance artifact — RecipeShowcase.
 *
 * A dev-only gallery that renders EVERY Signal-Slate base recipe in a
 * labeled grid, in both themes (via the in-page toggle). It exists so
 * the foundation can be screenshotted and reviewed before any screen is
 * assembled from these recipes in later phases.
 *
 * It is never loaded in normal use: `main.tsx` only imports it
 * (dynamically) when the URL carries `?lingua-showcase`, so it
 * code-splits into its own lazy chunk that stays out of the INITIAL
 * bundle. The chunk still ships in the build (the guard is a runtime
 * URL-param check Rollup cannot eliminate), by design — it is reviewed
 * against the prod `preview:web` build. Because it is an internal demo
 * surface, the literal demo strings here are allowed (the UNBREAKABLE
 * "no hardcoded copy" rule applies to the primitives, not to this
 * showcase).
 */

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowRight,
  Braces,
  FileText,
  Hash,
  Moon,
  Plus,
  Search,
  Sun,
  Zap,
} from 'lucide-react';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { StatusBadgeTone } from '../components/ui/StatusBadge';
import { ModalShell, Kbd } from '../components/ui/ModalShell';
import { Glyph } from '../components/ui/Glyph';
import { GLYPH_NAMES } from '../components/ui/glyphSet';
import { RunDot, RunStateGlyph } from '../components/ui/RunStateGlyph';
import { RUN_STATES, TAB_RUN_STATES, type RunState } from '../components/ui/runState';
import { LeaderRow, ResultNumeral, TypeTag } from '../components/ui/answer';
import { SpecRow, SpecCard, SettingsSection } from '../components/ui/SpecRow';
import { EmptyState } from '../components/ui/EmptyState';
import { ResultHeader } from '../components/ui/ResultHeader';
import { InlineMarker } from '../components/ui/InlineMarker';
import { RuntimeSelector } from '../components/ui/RuntimeSelector';

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-panel p-5">
      <div className="font-mono text-eyebrow font-semibold uppercase text-fg-muted">
        {title}
      </div>
      {children}
    </section>
  );
}

const RUN_STATE_LABELS: Record<RunState, string> = {
  'not-run': 'Not run',
  running: 'Running',
  answered: 'Answered',
  raised: 'Raised',
  paused: 'Paused',
  stale: 'Stale',
};

const MOTION_SPECIMENS = [
  { title: 'Pulse · 120 ms a line', detail: 'ease-out on the rail; ticks stay lit.', curve: 'M6 34C14 34 20 6 48 6' },
  { title: 'Answer · 160 ms', detail: 'leader draws, value fades up 4 px.', curve: 'M6 34C24 34 22 6 48 6' },
  { title: 'Reduced motion', detail: 'no travel; values appear in place.', curve: 'M6 34L48 6' },
];

const RESULT_HEADERS = [
  { tag: 'Code', value: '1.24', unit: 's', tabs: ['Console', 'Variables'] },
  { tag: 'SQL', value: '5', unit: 'rows', tabs: ['Table', 'Profile', 'Plan'] },
  { tag: 'HTTP', value: '200', unit: 'ok', tabs: ['Body', 'Headers', 'Timing'] },
];

const ALL_TONES: StatusBadgeTone[] = [
  'free',
  'pro',
  'unsaved',
  'success',
  'error',
  'warning',
  'info',
  'neutral',
];

export function RecipeShowcase() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState('body');
  const [running, setRunning] = useState(false);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggleTheme = () => {
    setDark((current) => !current);
  };

  return (
    <div className="min-h-screen bg-bg-base p-16 text-fg-base">
      <header className="mb-16 flex items-center justify-between">
        <div>
          <h1 className="text-h2 font-semibold text-fg-base">
            Signal-Slate · base recipes
          </h1>
          <p className="mt-1 text-body text-fg-subtle">
            Every token-driven foundation primitive, in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-subtle bg-bg-panel-alt px-3 text-body-sm text-fg-base hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          {dark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
          {dark ? 'Light theme' : 'Dark theme'}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* StatusBadge — all tones */}
        <Cell title="StatusBadge · all tones">
          <div className="flex flex-wrap items-center gap-3">
            {ALL_TONES.map((tone) => (
              <StatusBadge key={tone} tone={tone} dot={tone !== 'free'}>
                {tone}
              </StatusBadge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="free">FREE</StatusBadge>
            <StatusBadge tone="pro" dot>
              PRO
            </StatusBadge>
            <StatusBadge tone="unsaved" dot>
              Unsaved
            </StatusBadge>
            <StatusBadge tone="success" dot>
              200 OK
            </StatusBadge>
            <StatusBadge tone="error" dot>
              Error
            </StatusBadge>
          </div>
        </Cell>

        {/* RuntimeSelector — idle + running */}
        <Cell title="RuntimeSelector · idle + running">
          <RuntimeSelector
            languageLabel="JavaScript"
            languageGlyph={{ label: 'JS', className: 'bg-slate-500' }}
            modeLabel="Worker"
            onRun={() => setRunning((r) => !r)}
            running={false}
            runLabel="Run"
            runShortcut="⌘↵"
          />
          <RuntimeSelector
            languageLabel="Python"
            languageGlyph={{ label: 'PY', className: 'bg-slate-600' }}
            modeLabel="Native"
            onRun={() => setRunning((r) => !r)}
            running
            runLabel="Run"
            stopLabel="Stop"
          />
          <p className="text-caption text-fg-subtle">
            Toggle by clicking: running={String(running)}
          </p>
        </Cell>

        {/* ModalShell — rendered inline via a transform-contained wrapper */}
        <Cell title="ModalShell · header search + body rows + footer rail">
          {/* A `transform` on this box makes ModalShell's `fixed` scrim
              resolve to THIS container instead of the viewport, so the
              real component previews inline without covering the page. */}
          <div className="relative h-[340px] overflow-hidden rounded-lg [transform:translateZ(0)]">
            <ModalShell
              onClose={() => undefined}
              icon={<Search size={16} aria-hidden />}
              header={
                <span className="text-body text-fg-subtle">
                  Search templates, snippets, commands…
                </span>
              }
              trailing={<span className="font-mono text-caption text-fg-subtle">99 results</span>}
              size="max-w-[560px]"
            >
              <div className="flex flex-col gap-1">
                <div className="px-3 pb-1 pt-2 font-mono text-eyebrow font-semibold uppercase text-fg-muted">
                  Commands
                </div>
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-100 px-3 py-[9px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt text-accent">
                    <Zap size={14} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-fg-base">
                      Open Keyboard Shortcuts
                    </span>
                    <span className="block text-body-sm text-fg-subtle">
                      View every built-in shortcut with a live filter
                    </span>
                  </span>
                  <Kbd>⌘ /</Kbd>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-[9px] text-left hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-muted">
                    <FileText size={14} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-fg-base">Open File</span>
                    <span className="block text-body-sm text-fg-subtle">Open a file from disk</span>
                  </span>
                  <Kbd>⌘ O</Kbd>
                </button>
              </div>
            </ModalShell>
          </div>
        </Cell>

        {/* SettingsSection + SpecCard + SpecRow */}
        <Cell title="SettingsSection · SpecCard · SpecRow">
          <SettingsSection
            eyebrow="General · about"
            description="Read-only metadata becomes one spec card — not four stacked cards."
          >
            <SpecCard>
              <SpecRow
                label="Version"
                control={<span className="font-mono text-body-sm text-fg-base">0.4.0</span>}
              />
              <SpecRow
                label="Reopen last session"
                description="Restore tabs from the previous session on restart."
                control={
                  <span className="font-mono text-body-sm text-fg-base">On</span>
                }
              />
              <SpecRow
                label="License"
                last
                control={<span className="font-mono text-body-sm text-fg-base">Commercial</span>}
              />
            </SpecCard>
          </SettingsSection>
        </Cell>

        {/* EmptyState */}
        <Cell title="EmptyState · with CTA">
          <div className="grid min-h-[220px] place-items-center rounded-lg border border-border-subtle bg-bg-inset">
            <EmptyState
              icon={<Hash size={18} aria-hidden />}
              title="No query yet"
              description="Write a statement and run it — the result table lands right here."
              action={
                <span className="inline-flex items-center gap-[6px] rounded-md bg-accent px-3 py-[6px] text-body-sm font-medium text-fg-on-accent">
                  <Plus size={12} aria-hidden /> New query <Kbd>⌘↵</Kbd>
                </span>
              }
            />
          </div>
        </Cell>

        {/* ResultHeader */}
        <Cell title="ResultHeader · Body / Headers / Raw tabs">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-panel">
            <ResultHeader
              status={
                <StatusBadge tone="success" dot>
                  200 OK
                </StatusBadge>
              }
              meta="340 ms · 83 B"
              tabs={[
                { id: 'body', label: 'Body' },
                { id: 'headers', label: 'Headers' },
                { id: 'raw', label: 'Raw' },
              ]}
              activeTab={tab}
              onTabChange={setTab}
            />
            <div className="px-4 py-3 font-mono text-body-sm text-fg-muted">
              active tab: <span className="text-fg-base">{tab}</span>
            </div>
          </div>
        </Cell>

        {/* InlineMarker */}
        <Cell title="InlineMarker · type-aware + @watch">
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-inset px-4 py-3 font-mono text-body">
            <div className="flex items-center justify-between">
              <span className="text-fg-base">const doubled = counter * 2;</span>
              <InlineMarker value="10" type="number" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-base">counter * 10 // @watch</span>
              <InlineMarker value="50" type="number" watch />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-fg-base">user.name</span>
              <InlineMarker value="&quot;Ada&quot;" type="string" />
            </div>
          </div>
        </Cell>

        {/* Misc signal row */}
        <Cell title="Inline icons sanity (lucide)">
          <div className="flex items-center gap-4 text-fg-muted">
            <Braces size={16} aria-hidden />
            <ArrowRight size={16} aria-hidden />
            <Search size={16} aria-hidden />
            <Zap size={16} aria-hidden />
            <Hash size={16} aria-hidden />
          </div>
        </Cell>

        <Cell title="Glyphs and motion">
          <div
            className="text-fg-base"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 24px)', columnGap: 4, rowGap: 14, maxWidth: 332 }}
            data-testid="showcase-glyphs"
          >
            {GLYPH_NAMES.map((name) => (
              <span key={name} title={name} className="inline-flex">
                <Glyph name={name} label={name} />
              </span>
            ))}
          </div>
          <p className="text-body-sm text-fg-muted">16 px grid, 1.5 stroke, round joins.</p>
          <div key={replay} className="flex flex-col gap-3">
            {MOTION_SPECIMENS.map((specimen) => (
              <div key={specimen.title} className="flex items-center gap-3 text-body-sm text-fg-muted">
                <svg width="54" height="40" viewBox="0 0 54 40" aria-hidden style={{ flex: 'none' }}>
                  <rect x=".5" y=".5" width="53" height="39" rx="6" fill="none" stroke="var(--color-border-strong)" />
                  <path d={specimen.curve} fill="none" stroke="var(--color-fg-base)" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="flex flex-col">
                  <span className="font-semibold text-fg-base">{specimen.title}</span>
                  {specimen.detail}
                </span>
              </div>
            ))}
            <span className="flex items-center gap-2" aria-hidden>
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className="pulse-tick"
                  style={{ width: 2, height: 18, borderRadius: 1, '--pulse-index': index } as CSSProperties}
                />
              ))}
            </span>
          </div>
        </Cell>

        <Cell title="Run states · rail and tab dots">
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'repeat(3, 30px)', gridAutoFlow: 'column' }}
            data-testid="showcase-run-states"
          >
            {RUN_STATES.map((state) => (
              <span key={state} className="inline-flex items-center gap-3 text-body-sm font-semibold text-fg-base">
                <RunStateGlyph state={state} />
                {RUN_STATE_LABELS[state]}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {TAB_RUN_STATES.map((state) => (
              <span key={state} className="inline-flex items-center gap-2 font-mono text-body-sm text-fg-muted">
                <RunDot state={state} label={state} />
                {state}
              </span>
            ))}
          </div>
        </Cell>

        <Cell title="Answer primitives · TypeTag · LeaderRow · ResultNumeral · Kbd">
          <div key={replay} className="flex flex-col gap-3 font-mono text-body text-fg-base" data-testid="showcase-answers">
            <LeaderRow
              enter
              label="p95 = round(quantiles(db)[-1], 1)"
              value={
                <>
                  <TypeTag>float</TypeTag>
                  <span className="text-value-number">151.4</span>
                </>
              }
            />
            <LeaderRow
              enter
              tone="error"
              label="cache['slowest']"
              value={
                <>
                  <TypeTag>error</TypeTag>
                  <span className="text-value-error">KeyError</span>
                </>
              }
            />
          </div>
          <div className="flex flex-col rounded-lg border border-border-subtle bg-bg-inset px-4" data-testid="showcase-result-header">
            {RESULT_HEADERS.map((header, index) => (
              <div
                key={header.tag}
                className={index < RESULT_HEADERS.length - 1 ? 'flex items-center gap-4 border-b border-border-subtle' : 'flex items-center gap-4'}
                style={{ minHeight: 46 }}
              >
                <TypeTag className="w-10">{header.tag}</TypeTag>
                <ResultNumeral value={header.value} unit={header.unit} className="w-20" />
                <span className="flex items-center gap-3 text-body-sm text-fg-muted">
                  <span className="font-semibold text-fg-base">{header.tabs[0]}</span>
                  {header.tabs.slice(1).map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-baseline gap-6">
            <ResultNumeral size="sm" value="40.9" unit="ms" />
            <ResultNumeral size="lg" value="1.15" unit="s" />
            <ResultNumeral size="sm" value="KeyError" tone="error" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-body-sm text-fg-muted">
            <Kbd>⌘↵</Kbd>
            <Kbd>⌘K</Kbd>
            <Kbd>esc</Kbd>
            <button
              type="button"
              onClick={() => setReplay((count) => count + 1)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-subtle bg-bg-panel-alt px-3 text-body-sm text-fg-base hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Glyph name="refresh" />
              Replay motion
            </button>
          </div>
        </Cell>
      </div>
    </div>
  );
}
