import { Trash2 } from 'lucide-react';
import { useConsoleStore } from '../../stores/consoleStore';
import { useEffect, useRef } from 'react';
import type { ConsoleEntry } from '../../types';

const TYPE_STYLES: Record<ConsoleEntry['type'], string> = {
  log: 'text-gray-300',
  info: 'text-info-500',
  warn: 'text-warning-500',
  error: 'text-error-500',
  result: 'text-primary-400',
};

const TYPE_LABELS: Record<ConsoleEntry['type'], string> = {
  log: 'LOG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  result: 'RES',
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ConsolePanel() {
  const { entries, clear } = useConsoleStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="flex h-full flex-col bg-gray-950">
      <div className="flex h-8 items-center justify-between border-b border-gray-800 px-3">
        <span className="text-xs font-medium text-gray-400">Console</span>
        <button
          onClick={clear}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Clear console"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 font-mono text-xs leading-5"
      >
        {entries.length === 0 ? (
          <p className="text-gray-600 italic">Output will appear here...</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="shrink-0 text-gray-600">{formatTime(entry.timestamp)}</span>
              <span className={`shrink-0 font-bold ${TYPE_STYLES[entry.type]}`}>
                [{TYPE_LABELS[entry.type]}]
              </span>
              {entry.line !== undefined && (
                <span className="shrink-0 text-gray-600">L{entry.line}</span>
              )}
              <span className={`whitespace-pre-wrap ${TYPE_STYLES[entry.type]}`}>
                {entry.content}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
