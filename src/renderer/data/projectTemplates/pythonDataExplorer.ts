// SPDX-License-Identifier: MIT
/**
 * Python data explorer — 4 files. Loads a tiny inline CSV, runs basic
 * pandas summaries, and prints them. `requirements.txt` declares
 * `pandas`, `.gitignore` covers Python build artifacts + `.venv/`,
 * and a README explains how to run. Entry file is `explore.py`.
 */

import type { ProjectTemplateV1 } from '../../../shared/projectTemplate';

export const pythonDataExplorerTemplate: ProjectTemplateV1 = {
  schemaVersion: 1,
  id: 'python-data-explorer',
  labelKey: 'emptyState.projectTemplates.pythonDataExplorer.label',
  descriptionKey: 'emptyState.projectTemplates.pythonDataExplorer.description',
  language: 'python',
  entryFile: 'explore.py',
  files: [
    {
      relPath: 'explore.py',
      content: `# SPDX-License-Identifier: MIT
import io

import pandas as pd

CSV = """name,age,city
Ada,36,London
Grace,79,New York
Linus,21,Helsinki
Margaret,52,Boston
"""


def main() -> None:
    df = pd.read_csv(io.StringIO(CSV))
    print("Rows:", len(df))
    print("Mean age:", round(df["age"].mean(), 1))
    print(df.sort_values("age").to_string(index=False))


if __name__ == "__main__":
    main()
`,
    },
    {
      relPath: 'requirements.txt',
      content: `# SPDX-License-Identifier: MIT
pandas>=2.2
`,
    },
    {
      relPath: '.gitignore',
      content: `# SPDX-License-Identifier: MIT
__pycache__/
*.pyc
*.pyo
.venv/
.env
.env.local
.pytest_cache/
.ipynb_checkpoints/
`,
    },
    {
      relPath: 'README.md',
      content: `<!-- SPDX-License-Identifier: MIT -->
# Python data explorer

Tiny pandas scaffolding by Lingua. Loads an inline CSV and prints
summary stats.

## Run

\`\`\`
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python explore.py
\`\`\`
`,
    },
  ],
  dependencies: {
    pip: ['pandas'],
  },
  runCommand: 'python explore.py',
  license: 'MIT',
};
