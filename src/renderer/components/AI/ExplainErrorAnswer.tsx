/**
 * T19 — renders the AI "Explain this error" answer.
 *
 * Models reply in Markdown, so showing `phase.content` as raw
 * `whitespace-pre-wrap` text leaks the syntax (```` ``` ````, `**`, `1.`) and
 * is hard to read or apply. This splits the answer into prose and fenced code
 * blocks and renders each: prose gets lightweight inline formatting (bold,
 * inline code) + ordered/unordered lists; a code block renders in a mono panel
 * with a Copy button so the user applies a suggested fix in one click.
 *
 * Deliberately NOT a full Markdown engine + `dangerouslySetInnerHTML`: the
 * repo avoids inner-HTML injection, and a small structural renderer covers what
 * the models actually emit while staying dependency-light and safe by
 * construction (plain React text nodes, no HTML parsing).
 */

import { Fragment, type ReactNode, useMemo } from 'react';
import { CopyButton } from '../DeveloperUtilities/CopyButton';

type Segment =
  | { readonly kind: 'code'; readonly lang: string; readonly code: string }
  | { readonly kind: 'prose'; readonly text: string };

/** Split the answer on fenced code blocks; everything else is prose. */
function parseAnswer(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index).trim();
    if (before) segments.push({ kind: 'prose', text: before });
    segments.push({
      kind: 'code',
      lang: match[1] ?? '',
      code: (match[2] ?? '').replace(/\n$/, ''),
    });
    lastIndex = fence.lastIndex;
  }
  const tail = markdown.slice(lastIndex).trim();
  if (tail) segments.push({ kind: 'prose', text: tail });
  // No fences at all → the whole thing is one prose block.
  return segments.length > 0 ? segments : [{ kind: 'prose', text: markdown.trim() }];
}

/** Inline `**bold**` and `` `code` `` within a line → React nodes. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded bg-bg-panel-alt px-1 py-0.5 font-mono text-[0.85em] text-fg"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** A prose segment: paragraphs + `-`/`*` and `1.` lists. */
function ProseBlock({ text }: { readonly text: string }): ReactNode {
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (): void => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item)}</li>);
    nodes.push(
      list.ordered ? (
        <ol key={nodes.length} className="ml-4 list-decimal space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={nodes.length} className="ml-4 list-disc space-y-1">
          {items}
        </ul>
      )
    );
    list = null;
  };
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.*)/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)/.exec(line);
    const unordered = /^\s*[-*]\s+(.*)/.exec(line);
    if (heading) {
      // `#`..`######` headings (models love `## Fixes`) → a bold lead-in
      // rather than leaking the hashes as literal text.
      flush();
      nodes.push(
        <p key={nodes.length} className="mt-1 font-semibold text-fg">
          {renderInline(heading[1] ?? '')}
        </p>
      );
    } else if (ordered) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1] ?? '');
    } else if (unordered) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(unordered[1] ?? '');
    } else if (line.trim()) {
      // A non-empty, non-list line ends any open list and starts a paragraph.
      flush();
      nodes.push(
        <p key={nodes.length} className="leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
    // A blank line is ignored on purpose: models often leave one between list
    // items, and splitting the list there restarts numbering (1., 1. instead
    // of 1., 2.). Paragraphs are already separate nodes, so nothing is lost.
  }
  flush();
  return <div className="space-y-2">{nodes}</div>;
}

/** A fenced code block with a language chip + one-click Copy. */
function CodeBlock({ code, lang }: { readonly code: string; readonly lang: string }): ReactNode {
  return (
    <div className="overflow-hidden rounded border border-border bg-bg-panel-alt">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="font-mono text-micro uppercase tracking-wide text-fg-subtle">
          {lang}
        </span>
        <CopyButton value={code} testid="ai-explain-code-copy" />
      </div>
      <pre className="overflow-x-auto p-2 text-micro">
        <code className="font-mono text-fg">{code}</code>
      </pre>
    </div>
  );
}

export function ExplainErrorAnswer({ content }: { readonly content: string }): ReactNode {
  const segments = useMemo(() => parseAnswer(content), [content]);
  return (
    <div data-testid="ai-explain-result" className="space-y-3 text-fg">
      {segments.map((segment, index) =>
        segment.kind === 'code' ? (
          <CodeBlock key={index} code={segment.code} lang={segment.lang} />
        ) : (
          <ProseBlock key={index} text={segment.text} />
        )
      )}
    </div>
  );
}
