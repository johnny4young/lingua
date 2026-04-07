import { X } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import type { LayoutPreset } from '../../types';

// ---------------------------------------------------------------------------
// Available options
// ---------------------------------------------------------------------------

const EDITOR_THEMES: { id: string; label: string; dark: boolean }[] = [
  { id: 'runlang-dark', label: 'RunLang Dark', dark: true },
  { id: 'dracula', label: 'Dracula', dark: true },
  { id: 'one-dark-pro', label: 'One Dark Pro', dark: true },
  { id: 'monokai', label: 'Monokai', dark: true },
  { id: 'vs-dark', label: 'VS Dark', dark: true },
  { id: 'vs', label: 'VS Light', dark: false },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
  { id: 'hc-black', label: 'High Contrast Dark', dark: true },
];

const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', monospace", label: 'Fira Code' },
  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
  { value: "Menlo, monospace", label: 'Menlo' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: "monospace", label: 'System Monospace' },
];

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 24];

const LAYOUT_PRESETS: { id: LayoutPreset; label: string; description: string }[] = [
  { id: 'horizontal', label: 'Horizontal Split', description: 'Editor on top, console below' },
  { id: 'vertical', label: 'Vertical Split', description: 'Editor left, console right' },
  { id: 'editor-only', label: 'Editor Only', description: 'Hide console panel' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={onChange}
      className={`relative h-5 w-9 rounded-full transition-colors focus:outline-none ${
        value ? 'bg-primary-500' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    theme, setTheme,
    editorTheme, setEditorTheme,
    fontSize, setFontSize,
    fontFamily, setFontFamily,
    showLineNumbers, toggleLineNumbers,
    wordWrap, toggleWordWrap,
    minimap, toggleMinimap,
    layoutPreset, setLayoutPreset,
  } = useSettingsStore();
  const {
    status,
    supported,
    enabled,
    message,
    releaseName,
    lastCheckedAt,
    checkForUpdates,
    restartToApply,
  } = useUpdateStore();

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog */}
      <div className="relative w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-gray-100">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">

          {/* App Theme */}
          <Section title="Appearance">
            <Row label="App theme">
              <div className="flex gap-2">
                {(['dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                      theme === t
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          {/* Editor Theme */}
          <Section title="Editor">
            <Row label="Theme">
              <select
                value={editorTheme}
                onChange={(e) => setEditorTheme(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
              >
                {EDITOR_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </Row>
            <Row label="Font family">
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Row>
            <Row label="Font size">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFontSize(Math.max(10, fontSize - 1))}
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
                >
                  −
                </button>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>
                <button
                  onClick={() => setFontSize(Math.min(32, fontSize + 1))}
                  className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
                >
                  +
                </button>
              </div>
            </Row>
            <Row label="Line numbers">
              <Toggle value={showLineNumbers} onChange={toggleLineNumbers} />
            </Row>
            <Row label="Word wrap">
              <Toggle value={wordWrap} onChange={toggleWordWrap} />
            </Row>
            <Row label="Minimap">
              <Toggle value={minimap} onChange={toggleMinimap} />
            </Row>
          </Section>

          {/* Layout */}
          <Section title="Layout">
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setLayoutPreset(preset.id)}
                  title={preset.description}
                  className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                    layoutPreset === preset.id
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                  }`}
                >
                  <LayoutIcon preset={preset.id} active={layoutPreset === preset.id} />
                  <span className={`text-xs font-medium leading-tight ${
                    layoutPreset === preset.id ? 'text-primary-400' : 'text-gray-400'
                  }`}>
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Updates">
            <Row label="Status">
              <div className="max-w-[60%] text-right">
                <p className="text-xs text-gray-300">{message}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">
                  {status}
                </p>
                {releaseName && (
                  <p className="mt-1 text-[11px] text-gray-500">{releaseName}</p>
                )}
                {lastCheckedAt && (
                  <p className="mt-1 text-[11px] text-gray-600">
                    Last check: {new Date(lastCheckedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </Row>
            <Row label="Actions">
              <div className="flex gap-2">
                <button
                  onClick={() => void checkForUpdates()}
                  disabled={!supported || !enabled || status === 'checking'}
                  className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status === 'checking' ? 'Checking...' : 'Check now'}
                </button>
                <button
                  onClick={() => void restartToApply()}
                  disabled={status !== 'downloaded'}
                  className="rounded bg-primary-500/20 px-3 py-1 text-xs text-primary-400 transition-colors hover:bg-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restart to update
                </button>
              </div>
            </Row>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-gray-800 px-5 py-3">
          <p className="text-xs text-gray-600">Settings are saved automatically</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout preset icon
// ---------------------------------------------------------------------------

function LayoutIcon({ preset, active }: { preset: LayoutPreset; active: boolean }) {
  const base = active ? 'bg-primary-400' : 'bg-gray-600';
  const dim = active ? 'bg-primary-800' : 'bg-gray-700';

  if (preset === 'horizontal') {
    return (
      <div className="flex h-8 w-full flex-col gap-0.5 overflow-hidden rounded">
        <div className={`flex-[2] rounded-sm ${base}`} />
        <div className={`flex-1 rounded-sm ${dim}`} />
      </div>
    );
  }
  if (preset === 'vertical') {
    return (
      <div className="flex h-8 w-full flex-row gap-0.5 overflow-hidden rounded">
        <div className={`flex-[2] rounded-sm ${base}`} />
        <div className={`flex-1 rounded-sm ${dim}`} />
      </div>
    );
  }
  // editor-only
  return (
    <div className="flex h-8 w-full overflow-hidden rounded">
      <div className={`flex-1 rounded-sm ${base}`} />
    </div>
  );
}
