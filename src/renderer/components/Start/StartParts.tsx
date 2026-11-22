import type { ReactNode } from 'react';
import type { Language } from '../../types/language';
import { languageBadgeTone } from '../../utils/languageMeta';

export function LanguageSquare({ language }: { language: Language }) {
  const tone = languageBadgeTone(language);
  return (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 px-[3px] text-[9.5px] items-center justify-center rounded-md font-mono font-bold leading-none tracking-[0.02em]"
      style={{ background: tone.background, color: tone.foreground }}
      aria-hidden
    >
      {tone.code}
    </span>
  );
}

const LEADER_DOTS = {
  background: 'radial-gradient(circle, var(--color-border-strong) 1px, transparent 1.2px) 0 0 / 8px 2px repeat-x',
};

/** Styled inline so the palette can draw it without loading the Start stylesheet. */
export function DottedLeader() {
  return <span className="mx-1.5 h-0.5 min-w-[30px] flex-1" style={LEADER_DOTS} aria-hidden />;
}

export function SectionHeading({
  id,
  title,
  detail,
  action,
}: {
  id: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="start-heading whitespace-nowrap font-display italic text-fg-base">
        {title}
      </h2>
      {detail ? <span className="truncate text-[12.5px] text-fg-muted">{detail}</span> : null}
      {action ? <span className="ml-auto flex items-baseline gap-3">{action}</span> : null}
    </div>
  );
}
