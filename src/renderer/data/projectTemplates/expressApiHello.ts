// SPDX-License-Identifier: MIT
/**
 * Express API hello — 4 files. Spins up a minimal HTTP server with a
 * single GET `/hello` route, a `package.json` declaring the express
 * dependency, a `.gitignore` that pre-empts the `node_modules/` /
 * `.env` first-commit footgun (implementation note), and a README the user can
 * read inline. The entry file is `src/index.js` so the new tab opens
 * on the meaningful code rather than the manifest.
 */

import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';

export const expressApiHelloTemplate: ProjectTemplateV1 = {
  schemaVersion: 1,
  id: 'express-api-hello',
  labelKey: 'emptyState.projectTemplates.expressApiHello.label',
  descriptionKey: 'emptyState.projectTemplates.expressApiHello.description',
  language: 'javascript',
  entryFile: 'src/index.js',
  files: [
    {
      relPath: 'src/index.js',
      content: `// SPDX-License-Identifier: MIT
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.get('/hello', (_req, res) => {
  res.json({ message: 'Hello from Lingua + Express!' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(\`Server listening on http://localhost:\${port}\`);
});
`,
    },
    {
      relPath: 'package.json',
      content: `{
  "name": "express-api-hello",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
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
    {
      relPath: 'README.md',
      content: `<!-- SPDX-License-Identifier: MIT -->
# Express API hello

Minimal HTTP server scaffolded by Lingua.

## Run

\`\`\`
npm install
npm start
\`\`\`

Then visit http://localhost:3000/hello.
`,
    },
  ],
  dependencies: {
    npm: ['express'],
  },
  runCommand: 'npm start',
  license: 'MIT',
};
