// SPDX-License-Identifier: MIT
/**
 * React component sandbox — 5 files. A tiny Vite-style React entry
 * point with one component, index.html, package.json, .gitignore, and
 * a README. Entry file is `src/Counter.tsx` so the user lands on the
 * component itself, not the mount file.
 */

import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';

export const reactComponentSandboxTemplate: ProjectTemplateV1 = {
  schemaVersion: 1,
  id: 'react-component-sandbox',
  labelKey: 'emptyState.projectTemplates.reactComponentSandbox.label',
  descriptionKey:
    'emptyState.projectTemplates.reactComponentSandbox.description',
  language: 'typescript',
  entryFile: 'src/Counter.tsx',
  files: [
    {
      relPath: 'src/Counter.tsx',
      content: `// SPDX-License-Identifier: MIT
import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Hello from Lingua + React</h1>
      <p>You clicked {count} times.</p>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}
`,
    },
    {
      relPath: 'src/main.tsx',
      content: `// SPDX-License-Identifier: MIT
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Counter } from './Counter';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <Counter />
  </StrictMode>
);
`,
    },
    {
      relPath: 'index.html',
      content: `<!-- SPDX-License-Identifier: MIT -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>React component sandbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      relPath: 'package.json',
      content: `{
  "name": "react-component-sandbox",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
`,
    },
    {
      relPath: '.gitignore',
      content: `# SPDX-License-Identifier: MIT
node_modules/
dist/
.env
.env.local
*.log
`,
    },
  ],
  dependencies: {
    npm: ['react', 'react-dom'],
  },
  runCommand: 'npm install && npm run dev',
  license: 'MIT',
};
