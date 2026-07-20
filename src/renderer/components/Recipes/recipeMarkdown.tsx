/**
 * implementation — Minimal Markdown subset renderer for recipe
 * prompts.
 *
 * implementation prompts are 1–3 paragraphs + an inline `code` block + a
 * `fenced` code block + the occasional bullet list. That's exactly
 * what this renderer handles — no HTML pass-through, no
 * `dangerouslySetInnerHTML`, no arbitrary tag whitelist. If a
 * future implementation needs richer markdown (tables, images, footnotes),
 * swap in `react-markdown` (~30 KB) at that point; today it's
 * unjustified.
 *
 * Supported subset:
 *
 *   - `# Heading`, `## Heading`, `### Heading`
 *   - `paragraph text\n\nanother paragraph`
 *   - Inline ` `code` ` spans
 *   - Inline `**bold**` spans
 *   - Fenced ```` ```js / ```ts / ```text ```` code blocks
 *   - `- bullet item` / `* bullet item` lists
 *
 * Anything else renders as plain text (the underlying string is
 * surfaced verbatim, never as HTML).
 */

import { Fragment, type ReactNode } from 'react';

export interface RecipeMarkdownProps {
  readonly source: string;
}

interface ParagraphBlock {
  readonly kind: 'paragraph';
  readonly text: string;
}
interface HeadingBlock {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3;
  readonly text: string;
}
interface CodeBlock {
  readonly kind: 'code';
  readonly language: string;
  readonly content: string;
}
interface ListBlock {
  readonly kind: 'list';
  readonly items: ReadonlyArray<string>;
}
type Block = ParagraphBlock | HeadingBlock | CodeBlock | ListBlock;

/**
 * Parse the source into a small block AST. Splits on blank lines so
 * paragraphs and lists stay coherent; fenced code blocks are
 * captured greedy with whatever language tag they carry.
 */
function parseRecipeMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block — ```lang … ```
    const fenceOpen = line.match(/^```(\w*)\s*$/);
    if (fenceOpen) {
      const language = fenceOpen[1] ?? '';
      const code: string[] = [];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        if (/^```\s*$/.test(inner)) {
          i += 1;
          break;
        }
        code.push(inner);
        i += 1;
      }
      blocks.push({ kind: 'code', language, content: code.join('\n') });
      continue;
    }

    // Blank line — skip.
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2]?.trim() ?? '' });
      i += 1;
      continue;
    }

    // List — consecutive `- ` or `* ` lines.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        if (!/^[-*]\s+/.test(inner)) break;
        items.push(inner.replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    // Paragraph — collect until blank line / fence / heading / list.
    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const inner = lines[i] ?? '';
      if (inner.trim().length === 0) break;
      if (/^```/.test(inner)) break;
      if (/^#{1,3}\s+/.test(inner)) break;
      if (/^[-*]\s+/.test(inner)) break;
      paragraph.push(inner);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

/**
 * Render `**bold**` + ` `code` ` inline spans. Pure plain-text fallback
 * for anything we don't recognise.
 */
function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  // Tokenize: walk the string, peeking for `**` and `` ` `` markers.
  // Single-pass, no regex backtracking; safe on large inputs.
  while (cursor < text.length) {
    const next = findNextMarker(text, cursor);
    if (next === null) {
      parts.push(text.slice(cursor));
      break;
    }
    if (next.index > cursor) {
      parts.push(text.slice(cursor, next.index));
    }
    parts.push(
      <span
        key={`${next.kind}-${next.index}`}
        className={
          next.kind === 'code'
            ? 'rounded bg-surface/60 px-1 font-mono text-[0.95em] text-foreground'
            : 'font-semibold text-foreground'
        }
      >
        {next.body}
      </span>
    );
    cursor = next.end;
  }
  return parts;
}

interface InlineMarker {
  kind: 'code' | 'bold';
  index: number;
  end: number;
  body: string;
}

function findNextMarker(text: string, start: number): InlineMarker | null {
  const codeIdx = text.indexOf('`', start);
  const boldIdx = text.indexOf('**', start);
  const pickCode =
    codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx);
  if (pickCode && codeIdx !== -1) {
    const closing = text.indexOf('`', codeIdx + 1);
    if (closing === -1) return null;
    return {
      kind: 'code',
      index: codeIdx,
      end: closing + 1,
      body: text.slice(codeIdx + 1, closing),
    };
  }
  if (boldIdx !== -1) {
    const closing = text.indexOf('**', boldIdx + 2);
    if (closing === -1) return null;
    return {
      kind: 'bold',
      index: boldIdx,
      end: closing + 2,
      body: text.slice(boldIdx + 2, closing),
    };
  }
  return null;
}

export function RecipeMarkdown({ source }: RecipeMarkdownProps) {
  const blocks = parseRecipeMarkdown(source);
  return (
    <div data-testid="recipe-markdown" className="grid gap-2 text-body-sm text-foreground">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'heading': {
            const className =
              block.level === 1
                ? 'text-body-lg font-semibold tracking-tight'
                : block.level === 2
                  ? 'text-body font-semibold tracking-tight'
                  : 'text-body-sm font-semibold uppercase tracking-wider text-muted';
            const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
            return (
              <Tag key={`heading-${idx}`} className={className}>
                {renderInline(block.text)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={`paragraph-${idx}`} className="leading-relaxed">
                {renderInline(block.text)}
              </p>
            );
          case 'list':
            return (
              <ul key={`list-${idx}`} className="list-disc space-y-1 pl-5 text-body-sm">
                {block.items.map((item, itemIdx) => (
                  <li key={`item-${idx}-${itemIdx}`}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'code':
            return (
              <pre
                key={`code-${idx}`}
                data-language={block.language || 'text'}
                className="overflow-x-auto rounded border border-border/40 bg-background-elevated/60 p-2 font-mono text-caption text-foreground"
              >
                {block.content}
              </pre>
            );
          default:
            return <Fragment key={`unknown-${idx}`} />;
        }
      })}
    </div>
  );
}
