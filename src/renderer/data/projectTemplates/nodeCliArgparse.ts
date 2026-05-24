// SPDX-License-Identifier: MIT
/**
 * Node CLI with commander — 4 files. A tiny CLI that accepts a
 * `--name` flag and prints a greeting, a `package.json` declaring the
 * `commander` dependency + a `bin` mapping so `npx` works, a
 * `.gitignore`, and a README. Entry file is `bin/cli.js`.
 */

import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';

export const nodeCliArgparseTemplate: ProjectTemplateV1 = {
  schemaVersion: 1,
  id: 'node-cli-argparse',
  labelKey: 'emptyState.projectTemplates.nodeCliArgparse.label',
  descriptionKey: 'emptyState.projectTemplates.nodeCliArgparse.description',
  language: 'javascript',
  entryFile: 'bin/cli.js',
  files: [
    {
      relPath: 'bin/cli.js',
      content: `#!/usr/bin/env node
// SPDX-License-Identifier: MIT
const { Command } = require('commander');

const program = new Command();

program
  .name('greet')
  .description('Tiny CLI scaffolded by Lingua')
  .option('-n, --name <name>', 'name to greet', 'world')
  .action((options) => {
    // eslint-disable-next-line no-console
    console.log(\`Hello, \${options.name}!\`);
  });

program.parse(process.argv);
`,
    },
    {
      relPath: 'package.json',
      content: `{
  "name": "greet-cli",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "bin": {
    "greet": "bin/cli.js"
  },
  "scripts": {
    "start": "node bin/cli.js"
  },
  "dependencies": {
    "commander": "^12.0.0"
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
# Greet CLI

Tiny command-line tool scaffolded by Lingua.

## Run

\`\`\`
npm install
node bin/cli.js --name "your name"
\`\`\`
`,
    },
  ],
  dependencies: {
    npm: ['commander'],
  },
  runCommand: 'node bin/cli.js',
  license: 'MIT',
};
