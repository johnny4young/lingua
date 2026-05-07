/**
 * RL-062 requires the repo to ship a real LICENSE file matching the README's
 * distribution posture. This guard fails CI if anyone lands a change that
 * removes LICENSE, drops the README posture section, or reintroduces an MIT
 * badge — any of those would republish the product under the wrong terms.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const LICENSE_PATH = resolve(REPO_ROOT, 'LICENSE');
const README_PATH = resolve(REPO_ROOT, 'README.md');
const PACKAGE_PATH = resolve(REPO_ROOT, 'package.json');

describe('repository license posture (RL-062)', () => {
  it('ships a LICENSE file at the repo root', () => {
    expect(existsSync(LICENSE_PATH)).toBe(true);
  });

  it('LICENSE declares the commercial source-available posture and copyright', () => {
    const license = readFileSync(LICENSE_PATH, 'utf-8');
    expect(license).toContain('Lingua Commercial License');
    expect(license).toContain('All rights reserved');
    expect(license).toContain('NOT distributed under an open-source license');
  });

  it('README carries a license badge that links to the LICENSE file', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    // The License badge alt text starts with `![License` and the surrounding
    // markdown link must point at ./LICENSE. We don't regex the full link
    // because the shields.io URL contains embedded parens.
    expect(readme).toMatch(/!\[License/);
    expect(readme).toContain('](./LICENSE)');
    expect(readme).not.toMatch(/img\.shields\.io\/badge\/license-MIT/i);
  });

  it('README intro, pricing, and audience sections are present', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('Multi-language desktop code runner');
    expect(readme).toContain('## Pricing and licensing');
    expect(readme).toContain('## Who it is for');
    expect(readme).toContain('linguacode.dev');
  });

  it('README declares the post-RL-063 live-checkout posture', () => {
    // Before RL-063 shipped (2026-05-05) the README said "checkout
    // planned … once `RL-063` ships". Now the marketing site is live
    // at linguacode.dev, so the README must say so. The licensing
    // posture itself ("separate commercial license from the Licensor")
    // and the rejection of the "purchased via …" pattern still hold.
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('separate commercial license from the Licensor');
    expect(readme).toMatch(/checkout (and download surface )?is live/i);
    expect(readme).toContain('linguacode.dev');
    expect(readme).not.toMatch(/commercial license purchased via/i);
  });

  it('README and LICENSE name the public launch tiers (post-2026-05-07 model)', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    const license = readFileSync(LICENSE_PATH, 'utf-8');

    // Canonical public tiers after the 2026-05-07 launch-readiness
    // cleanup: Free, Monthly, Pro, Education. Backend slugs stay
    // stable; public/legal copy must not expose Lifetime/Team naming.
    for (const tier of ['Free', 'Monthly', 'Pro', 'Education']) {
      expect(readme, `README must mention ${tier}`).toContain(tier);
      expect(license, `LICENSE must mention ${tier}`).toContain(tier);
    }

    expect(readme).not.toMatch(/^- \*\*Pro Lifetime\*\*/mu);
    expect(readme).not.toMatch(/^- \*\*Team\*\*/mu);
    expect(license).not.toMatch(/\bPro Lifetime\b/u);
    expect(license).not.toMatch(/\bTeam\b/u);
  });

  it('package.json no longer claims the MIT license', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')) as {
      license: string;
    };
    expect(pkg.license).not.toBe('MIT');
    expect(pkg.license).toMatch(/SEE LICENSE IN LICENSE/);
  });
});
