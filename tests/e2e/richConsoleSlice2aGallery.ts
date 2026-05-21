import fs from 'node:fs';
import path from 'node:path';

export interface RichConsoleScreenshotCase {
  fileName: string;
  title: string;
  payload: string;
  assertions: string[];
}

export const RICH_CONSOLE_SCREENSHOT_CASES: RichConsoleScreenshotCase[] = [
  {
    fileName: '01-html-inline.png',
    title: 'HTML inline',
    payload: `{ kind: 'html', html, height: 160 }`,
    assertions: [
      'iframe renders inline inside the console row',
      'sandbox attribute is allow-scripts',
      'srcDoc content is visible inside the frame',
    ],
  },
  {
    fileName: '02-html-popover.png',
    title: 'HTML details popover',
    payload: `{ kind: 'html', html, height: 160 }`,
    assertions: [
      'details action opens the console entry popover',
      'popover Preview tab routes to RichValueHtml',
      'HTML iframe remains sandboxed in the popover',
    ],
  },
  {
    fileName: '03-image-inline.png',
    title: 'Image inline',
    payload: `{ kind: 'image', src: 'data:image/svg+xml;base64,...', mime }`,
    assertions: [
      'image payload passes the data URL allowlist',
      'image element renders inline inside the console row',
      'wrapper keeps readable contrast in the dark theme',
    ],
  },
  {
    fileName: '04-image-popover.png',
    title: 'Image details popover',
    payload: `{ kind: 'image', src: 'data:image/svg+xml;base64,...', mime }`,
    assertions: [
      'details action opens the console entry popover',
      'popover Preview tab routes to RichValueImage',
      'image remains visible at popover scale',
    ],
  },
  {
    fileName: '05-error-inline.png',
    title: 'Error inline',
    payload: `{ kind: 'error', message, stack: [{ file, line, column, text }] }`,
    assertions: [
      'structured error renders inline',
      'clickable stack frame is visible',
      'plain text stack frame remains non-clickable',
    ],
  },
  {
    fileName: '06-error-popover.png',
    title: 'Error details popover',
    payload: `{ kind: 'error', message, stack: [{ file, line, column, text }] }`,
    assertions: [
      'details action opens the console entry popover',
      'popover Preview tab routes to RichValueError',
      'clickable stack frame is preserved in preview',
    ],
  },
  {
    fileName: '07-error-context-menu.png',
    title: 'Error frame context menu',
    payload: `{ kind: 'error', message, stack: [{ file, line, column, text }] }`,
    assertions: [
      'right-click opens the frame context menu',
      'menu exposes Copy file:line',
      'menu exposes Open in tab and Copy frame text',
    ],
  },
  {
    fileName: '08-invalid-media-fallbacks.png',
    title: 'Invalid media fallbacks',
    payload: `[{ kind: 'image', src: 'javascript:alert(1)' }, { kind: 'html', html: '' }]`,
    assertions: [
      'unsafe image URL is rejected visibly',
      'empty HTML payload is rejected visibly',
      'fallback states remain readable in the console row',
    ],
  },
  {
    fileName: '09-chart-inline.png',
    title: 'Chart inline',
    payload: `{ kind: 'chart', spec: { mark: 'bar', data: { values } } }`,
    assertions: [
      'vega-embed chunk loads on first chart payload',
      'chart reaches data-chart-status ready',
      'canvas renderer paints inline inside the console row',
    ],
  },
  {
    fileName: '10-chart-popover-menu.png',
    title: 'Chart details popover and menu',
    payload: `{ kind: 'chart', spec: { mark: 'bar', data: { values } } }`,
    assertions: [
      'details action opens the console entry popover',
      'popover Preview tab routes to RichValueChart',
      'Free-tier export action shows the Pro-gated menu item',
    ],
  },
];

const pageStyles = `
  :root {
    color-scheme: dark;
    --bg: #071111;
    --panel: #0b1717;
    --panel-strong: #0f2424;
    --border: #244040;
    --text: #edfafa;
    --muted: #9fb4b4;
    --accent: #4cc9a4;
    --code: #d6fff4;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: radial-gradient(circle at top left, #123434 0, transparent 32rem), var(--bg);
    color: var(--text);
    font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  main {
    width: min(1180px, calc(100vw - 48px));
    margin: 0 auto;
    padding: 42px 0 56px;
  }

  header {
    display: grid;
    gap: 12px;
    margin-bottom: 28px;
  }

  h1 {
    margin: 0;
    font-size: clamp(30px, 5vw, 52px);
    line-height: 1;
    letter-spacing: 0;
  }

  p {
    margin: 0;
    color: var(--muted);
    max-width: 760px;
  }

  code,
  pre {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  pre {
    margin: 18px 0 0;
    padding: 14px 16px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #061010;
    color: var(--code);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
    gap: 18px;
  }

  article {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 92%, black);
  }

  figure {
    margin: 0;
  }

  img {
    display: block;
    width: 100%;
    height: auto;
    background: #020707;
    border-bottom: 1px solid var(--border);
  }

  figcaption {
    display: grid;
    gap: 10px;
    padding: 16px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0;
  }

  .payload {
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 4px 7px;
    border: 1px solid #24514a;
    border-radius: 6px;
    background: var(--panel-strong);
    color: var(--code);
  }

  ul {
    margin: 0;
    padding-left: 18px;
    color: var(--muted);
  }

  a {
    color: var(--accent);
  }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderCaseCard(item: RichConsoleScreenshotCase): string {
  const assertions = item.assertions
    .map(assertion => `<li>${escapeHtml(assertion)}</li>`)
    .join('\n            ');

  return `
      <article>
        <figure>
          <img src="./${escapeHtml(item.fileName)}" alt="${escapeHtml(item.title)}" loading="lazy" />
          <figcaption>
            <h2>${escapeHtml(item.title)}</h2>
            <code class="payload">${escapeHtml(item.payload)}</code>
            <ul>
              ${assertions}
            </ul>
          </figcaption>
        </figure>
      </article>`;
}

export function writeRichConsoleScreenshotGallery(screenshotDir: string): string {
  const htmlPath = path.join(screenshotDir, 'index.html');
  const cards = RICH_CONSOLE_SCREENSHOT_CASES.map(renderCaseCard).join('\n');

  fs.writeFileSync(
    htmlPath,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lingua rich console Slice 2a visual matrix</title>
    <style>${pageStyles}</style>
  </head>
  <body>
    <main>
      <header>
        <h1>Rich console Slice 2a visual matrix</h1>
        <p>
          Generated by <code>tests/e2e/richConsoleSlice2a.spec.ts</code>.
          Regenerate with <code>npm run test:e2e:web -- tests/e2e/richConsoleSlice2a.spec.ts</code>.
        </p>
        <pre>open output/playwright/rich-console-slice2a/index.html</pre>
      </header>
      <section class="grid" aria-label="Screenshot matrix">
${cards}
      </section>
    </main>
  </body>
</html>
`,
    'utf8'
  );

  return htmlPath;
}
