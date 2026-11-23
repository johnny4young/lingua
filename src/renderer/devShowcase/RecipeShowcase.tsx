/**
 * Acceptance artifact — RecipeShowcase.
 *
 * A dev-only gallery that renders EVERY Signal-Slate base recipe in a
 * labeled grid, in every palette (via the in-page switch). It exists so
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

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight, Braces, FileText, Hash, Plus, Search, Zap } from 'lucide-react';
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
import { applyAppTheme } from '../utils/appTheme';
import { identityPaletteFor, isDarkEditorTheme } from '../utils/editorThemeCatalog';
import './recipeShowcase.css';

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="recipe-showcase-cell flex min-w-0 flex-col gap-3 rounded-lg border border-border-subtle bg-bg-panel">
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
  { workspace: 'code', value: '1.24', unit: 's', tabs: ['Console', 'Variables'] },
  { workspace: 'sql', value: '5', unit: 'rows', tabs: ['Table', 'Profile', 'Plan'] },
  { workspace: 'http', value: '200', unit: 'ok', tabs: ['Body', 'Headers', 'Timing'] },
] as const;

type ShowcaseWorkspace = (typeof RESULT_HEADERS)[number]['workspace'];

const PALETTES = [
  { theme: 'lingua-dark', label: 'Classic dark' },
  { theme: 'lingua-light', label: 'Classic light' },
  { theme: 'lingua-ink', label: 'Ink' },
  { theme: 'lingua-paper', label: 'Paper' },
] as const;

type ShowcaseTheme = (typeof PALETTES)[number]['theme'];

function applyShowcaseTheme(theme: ShowcaseTheme): void {
  const palette = identityPaletteFor(theme);
  // Ink and Paper ship with Recursive as the code face.
  applyAppTheme(isDarkEditorTheme(theme) ? 'dark' : 'light', document, palette, palette !== null);
}

/** Start on whatever the boot script applied. */
function bootTheme(): ShowcaseTheme {
  const { palette, theme } = document.documentElement.dataset;
  if (palette === 'ink' || palette === 'paper') return `lingua-${palette}`;
  return theme === 'light' ? 'lingua-light' : 'lingua-dark';
}

const SWATCHES = [
  { name: 'ground', token: '--color-bg-base', kind: 'fill' },
  { name: 'panel', token: '--color-bg-panel', kind: 'fill' },
  { name: 'raised', token: '--color-bg-panel-alt', kind: 'fill' },
  { name: 'inset', token: '--color-bg-inset', kind: 'fill' },
  { name: 'text', token: '--color-fg-base', kind: 'ink' },
  { name: 'text 2', token: '--color-fg-muted', kind: 'ink' },
  { name: 'text 3', token: '--color-fg-subtle', kind: 'ink' },
  { name: 'pulse', token: '--color-pulse', kind: 'pulse' },
  { name: 'number', token: '--color-value-number', kind: 'ink' },
  { name: 'string', token: '--color-value-string', kind: 'ink' },
  { name: 'boolean', token: '--color-value-boolean', kind: 'ink' },
  { name: 'error', token: '--color-value-error', kind: 'ink' },
  { name: 'date', token: '--color-value-date', kind: 'ink' },
  { name: 'none', token: '--color-value-none', kind: 'ink' },
] as const;

/** Resolve tokens to sRGB through a canvas pixel, since computed oklch() stays oklch(). */
function readSwatchColours(): Map<string, [number, number, number]> | null {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const styles = getComputedStyle(document.documentElement);
  const colours = new Map<string, [number, number, number]>();
  for (const token of [...SWATCHES.map((swatch) => swatch.token), '--color-pulse-on']) {
    // An empty or unparsable value leaves the pixel clear instead of repeating the last colour.
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'transparent';
    context.fillStyle = styles.getPropertyValue(token).trim();
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    if (a > 0) colours.set(token, [r, g, b]);
  }
  return colours;
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Remounted per palette, so it reads the tokens the switch just applied. */
function PaletteSwatches() {
  const [colours] = useState(readSwatchColours);
  const ground = colours?.get('--color-bg-base');
  const onPulse = colours?.get('--color-pulse-on');
  return (
    <div className="recipe-showcase-swatches" data-testid="showcase-swatches">
      {SWATCHES.map(({ name, token, kind }) => {
        const rgb = colours?.get(token);
        // Text and values read on the ground; the pulse fill carries its own dark text.
        const against = kind === 'pulse' ? onPulse : ground;
        const ratio = kind === 'fill' || !rgb || !against ? null : contrast(rgb, against);
        const style =
          kind === 'fill'
            ? { background: `var(${token})`, color: 'var(--color-fg-base)' }
            : kind === 'pulse'
              ? { background: `var(${token})`, color: 'var(--color-pulse-on)' }
              : { background: 'var(--color-bg-base)', color: `var(${token})` };
        return (
          <span key={token} className="recipe-showcase-swatch" style={style}>
            <span>{name}</span>
            {rgb ? <span>{ratio ? `${hex(rgb)} · ${ratio.toFixed(1)}` : hex(rgb)}</span> : null}
          </span>
        );
      })}
    </div>
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
  // Applied before the state settles, so the swatches read the new tokens on their first render.
  const [theme, setTheme] = useState(() => {
    const initial = bootTheme();
    applyShowcaseTheme(initial);
    return initial;
  });
  const [views, setViews] = useState(() =>
    Object.fromEntries(RESULT_HEADERS.map((header) => [header.workspace, header.tabs[0]])) as Record<ShowcaseWorkspace, string>
  );
  const [replay, setReplay] = useState(0);

  const choosePalette = (next: ShowcaseTheme) => {
    applyShowcaseTheme(next);
    setTheme(next);
  };

  return (
    <div className="recipe-showcase bg-bg-base text-fg-base">
      <header className="recipe-showcase-header">
        <h1 className="text-h2 font-semibold text-fg-base">Signal-Slate · base recipes</h1>
        <div
          role="radiogroup"
          aria-label="Palette"
          data-testid="showcase-palette"
          className="inline-flex w-fit rounded-lg border border-border-subtle bg-bg-inset p-0.5"
        >
          {PALETTES.map((option) => (
            <button
              key={option.theme}
              type="button"
              role="radio"
              aria-checked={theme === option.theme}
              data-testid={`showcase-palette-${option.theme}`}
              onClick={() => choosePalette(option.theme)}
              className={`focus-ring min-h-8 rounded-md px-2.5 text-caption font-medium ${
                theme === option.theme ? 'bg-bg-panel text-fg-base shadow-e1' : 'text-fg-muted hover:text-fg-base'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="recipe-showcase-grid grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Cell title="Palette · grounds, text, pulse and values">
          <PaletteSwatches key={theme} />
        </Cell>

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
            onRun={() => undefined}
            running={false}
            runLabel="Run"
            runShortcut="⌘↵"
          />
          <RuntimeSelector
            languageLabel="Python"
            languageGlyph={{ label: 'PY', className: 'bg-slate-600' }}
            modeLabel="Native"
            onRun={() => undefined}
            running
            runLabel="Run"
            stopLabel="Stop"
          />
        </Cell>

        {/* ModalShell — rendered inline via a transform-contained wrapper */}
        <Cell title="ModalShell · header search + body rows + footer rail">
          {/* A `transform` on this box makes ModalShell's `fixed` scrim
              resolve to THIS container instead of the viewport, so the
              real component previews inline without covering the page. */}
          <div className="recipe-showcase-modal relative overflow-hidden rounded-lg [transform:translateZ(0)]">
            <ModalShell
              onClose={() => undefined}
              icon={<Search size={16} aria-hidden />}
              header={
                <span className="block truncate text-body text-fg-subtle">
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
        <Cell title="ResultHeader · code, SQL, HTTP">
          <div className="recipe-showcase-headers overflow-hidden rounded-lg border border-border-subtle" data-testid="showcase-result-header">
            {RESULT_HEADERS.map((header) => (
              <ResultHeader
                key={header.workspace}
                workspace={header.workspace}
                numeral={{ value: header.value, unit: header.unit }}
                tabs={header.tabs.map((name) => ({ id: name, label: name }))}
                activeTab={views[header.workspace]}
                onTabChange={(id) => setViews((current) => ({ ...current, [header.workspace]: id }))}
              />
            ))}
          </div>
        </Cell>

        {/* InlineMarker */}
        <Cell title="InlineMarker · type-aware + @watch">
          <div className="recipe-showcase-markers flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-inset px-4 py-3 font-mono text-body" data-testid="showcase-inline-markers">
            <div>
              <span className="text-fg-base">const doubled = counter * 2;</span>
              <InlineMarker value="10" type="number" />
            </div>
            <div>
              <span className="text-fg-base">counter * 10 // @watch</span>
              <InlineMarker value="50" type="number" watch />
            </div>
            <div>
              <span className="text-fg-base">user.name</span>
              <InlineMarker value='"Ada"' type="string" />
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
          <div key={replay} className="recipe-showcase-leaders flex flex-col gap-3 font-mono text-body text-fg-base" data-testid="showcase-answers">
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
