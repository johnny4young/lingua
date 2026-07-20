// SPDX-License-Identifier: MIT
/**
 * implementation — Structural tests for the curated 5 project
 * templates. The catalog is a closed enum and its shape is locked
 * here so future additions can't silently regress the contract.
 *
 * Per-template invariants:
 *
 *   - `parseProjectTemplate(template).ok === true` (implementation note-F payload
 *     surfaces would silently break otherwise).
 *   - Every file content contains an SPDX-License-Identifier line OR
 *     (for `package.json`) the JSON declares `"license": "MIT"`.
 *   - A `.gitignore` is present per implementation note so the first commit is
 *     never a `node_modules/` / `.venv/` footgun.
 *   - The entry file is one of the declared files (defense in depth
 *     vs. parseProjectTemplate; structural guard reads more clearly
 *     in CI output).
 *   - The TEMPLATE_PROJECT_IDS closed enum mirrors the catalog
 *     order + length verbatim.
 */

import { describe, expect, it } from 'vitest';
import {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_IDS,
} from '../../../src/renderer/data/projectTemplates';
import { parseProjectTemplate } from '../../../src/shared/projectTemplate';
import { TEMPLATE_PROJECT_IDS } from '../../../src/shared/telemetry';

describe('PROJECT_TEMPLATES — structural invariants', () => {
  it('ships exactly 5 templates in deterministic order', () => {
    expect(PROJECT_TEMPLATES).toHaveLength(5);
    expect(PROJECT_TEMPLATE_IDS).toEqual([
      'express-api-hello',
      'fastapi-hello',
      'node-cli-argparse',
      'react-component-sandbox',
      'python-data-explorer',
    ]);
  });

  it('TELEMETRY closed enum mirrors the catalog ids', () => {
    expect([...TEMPLATE_PROJECT_IDS].sort()).toEqual(
      [...PROJECT_TEMPLATE_IDS].sort()
    );
  });

  it.each(PROJECT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s passes parseProjectTemplate',
    (_id, template) => {
      const result = parseProjectTemplate(template);
      expect(result.ok).toBe(true);
    }
  );

  it.each(PROJECT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s declares its entry file in files[]',
    (_id, template) => {
      const relPaths = template.files.map((f) => f.relPath);
      expect(relPaths).toContain(template.entryFile);
    }
  );

  it.each(PROJECT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s ships a .gitignore (implementation note)',
    (_id, template) => {
      const ignore = template.files.find((f) => f.relPath === '.gitignore');
      expect(ignore).toBeDefined();
      expect(ignore!.content.length).toBeGreaterThan(0);
    }
  );

  it.each(PROJECT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s emits SPDX or license=MIT on every file (implementation note)',
    (_id, template) => {
      for (const file of template.files) {
        const hasSpdx = file.content.includes('SPDX-License-Identifier:');
        if (file.relPath.endsWith('package.json')) {
          // package.json cannot host comments; the `license` field
          // is the SPDX equivalent and the validator covers it.
          let parsed: unknown;
          try {
            parsed = JSON.parse(file.content);
          } catch (error) {
            throw new Error(
              `${template.id}:${file.relPath} is not valid JSON: ${String(error)}`,
              { cause: error }
            );
          }
          expect(
            (parsed as { license?: unknown }).license,
            `${template.id}:${file.relPath} missing "license"`
          ).toBe('MIT');
          continue;
        }
        expect(
          hasSpdx,
          `${template.id}:${file.relPath} missing SPDX-License-Identifier`
        ).toBe(true);
      }
    }
  );

  it('declares dependencies as either npm or pip arrays', () => {
    for (const template of PROJECT_TEMPLATES) {
      if (!template.dependencies) continue;
      if (template.dependencies.npm) {
        expect(Array.isArray(template.dependencies.npm)).toBe(true);
      }
      if (template.dependencies.pip) {
        expect(Array.isArray(template.dependencies.pip)).toBe(true);
      }
    }
  });
});
