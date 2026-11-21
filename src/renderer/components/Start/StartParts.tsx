import type { ReactNode } from 'react';
import type { Language } from '../../types/language';
import { languageBadgeTone } from '../../utils/languageMeta';

export function LanguageSquare({ language }: { language: Language }) {
  const tone = languageBadgeTone(language);
  return (
    <span
      className="start-lang inline-flex h-5 shrink-0 items-center justify-center rounded-md font-mono font-bold leading-none tracking-[0.02em]"
      style={{ background: tone.background, color: tone.foreground }}
      aria-hidden
    >
      {tone.code}
    </span>
  );
}

export function DottedLeader() {
  return (
    <span
      className="start-leader"
      aria-hidden
    />
  );
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
