/**
 * FASE 0 acceptance artifact — RecipeShowcase.
 *
 * A dev-only gallery that renders EVERY Signal-Slate FASE 0 recipe in a
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
import type { ReactNode } from 'react';
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
import { SpecRow, SpecCard, SettingsSection } from '../components/ui/SpecRow';
import { EmptyState } from '../components/ui/EmptyState';
import { ResultHeader } from '../components/ui/ResultHeader';
import { InlineMarker } from '../components/ui/InlineMarker';
import { RuntimeSelector } from '../components/ui/RuntimeSelector';

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-panel p-5">
      <div className="font-mono text-[10.5px] font-semibold uppercase text-fg-muted">
        {title}
      </div>
      {children}
    </section>
  );
}

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

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggleTheme = () => {
    setDark((current) => !current);
  };

  return (
    <div className="min-h-screen bg-bg-base p-8 text-fg-base">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-fg-base">
            Signal-Slate · FASE 0 recipes
          </h1>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Every token-driven foundation primitive, in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-subtle bg-bg-panel-alt px-3 text-[12.5px] text-fg-base hover:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
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
          <p className="text-[11.5px] text-fg-subtle">
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
                <span className="text-[14px] text-fg-subtle">
                  Search templates, snippets, commands…
                </span>
              }
              trailing={<span className="font-mono text-[11px] text-fg-subtle">99 results</span>}
              size="max-w-[560px]"
            >
              <div className="flex flex-col gap-1">
                <div className="px-3 pb-1 pt-2 font-mono text-[10.5px] font-semibold uppercase text-fg-muted">
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
                    <span className="block text-[13.5px] font-medium text-fg-base">
                      Open Keyboard Shortcuts
                    </span>
                    <span className="block text-[12px] text-fg-subtle">
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
                    <span className="block text-[13.5px] font-medium text-fg-base">Open File</span>
                    <span className="block text-[12px] text-fg-subtle">Open a file from disk</span>
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
                control={<span className="font-mono text-[12.5px] text-fg-base">0.4.0</span>}
              />
              <SpecRow
                label="Reopen last session"
                description="Restore tabs from the previous session on restart."
                control={
                  <span className="font-mono text-[12.5px] text-fg-base">On</span>
                }
              />
              <SpecRow
                label="License"
                last
                control={<span className="font-mono text-[12.5px] text-fg-base">Commercial</span>}
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
                <span className="inline-flex items-center gap-[6px] rounded-md bg-accent px-3 py-[6px] text-[12px] font-medium text-fg-on-accent">
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
            <div className="px-4 py-3 font-mono text-[12.5px] text-fg-muted">
              active tab: <span className="text-fg-base">{tab}</span>
            </div>
          </div>
        </Cell>

        {/* InlineMarker */}
        <Cell title="InlineMarker · type-aware + @watch">
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-inset px-4 py-3 font-mono text-[13px]">
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
      </div>
    </div>
  );
}
