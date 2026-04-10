import { X } from 'lucide-react';
import { AppearanceSection } from './AppearanceSection';
import { EditorSection } from './EditorSection';
import { LayoutSection } from './LayoutSection';
import { PluginsSection } from './PluginsSection';
import { UpdatesSection } from './UpdatesSection';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard className="relative w-full max-w-4xl">
        <div className="surface-header flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <p className="panel-title">Workspace Settings</p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Tune the shell, editor, and runtime defaults
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              The interface supports both dark and light shells, while Monaco keeps its own theme
              pipeline for code editing. Changes are saved automatically.
            </p>
          </div>
          <IconButton onClick={onClose} title="Close settings">
            <X size={16} />
          </IconButton>
        </div>

        <div className="max-h-[78vh] overflow-y-auto px-6 py-5">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-8">
              <AppearanceSection />
              <LayoutSection />
              <UpdatesSection />
            </div>
            <div className="space-y-8">
              <EditorSection />
              <PluginsSection />
            </div>
          </div>
        </div>

        <div className="surface-header flex items-center justify-between px-6 py-3">
          <p className="text-xs text-muted">
            Settings persist locally across desktop and web sessions.
          </p>
          <span className="status-pill">Autosave enabled</span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
