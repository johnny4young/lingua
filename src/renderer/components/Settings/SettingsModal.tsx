import { X } from 'lucide-react';
import { AppearanceSection } from './AppearanceSection';
import { EditorSection } from './EditorSection';
import { LayoutSection } from './LayoutSection';
import { PluginsSection } from './PluginsSection';
import { UpdatesSection } from './UpdatesSection';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
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
          <AppearanceSection />
          <EditorSection />
          <LayoutSection />
          <UpdatesSection />
          <PluginsSection />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-gray-800 px-5 py-3">
          <p className="text-xs text-gray-600">Settings are saved automatically</p>
        </div>
      </div>
    </div>
  );
}
