import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';
import { CLI_HELP_CATALOG } from '../../src/cli/helpCatalog';

const ROOT = resolve(__dirname, '../..');
const SKILL_PATH = resolve(ROOT, 'skills/lingua-verify/SKILL.md');
const CLAUDE_PLUGIN_PATH = resolve(ROOT, 'skills/.claude-plugin/plugin.json');
const CLAUDE_MARKETPLACE_PATH = resolve(ROOT, '.claude-plugin/marketplace.json');
const MINIMUM_CLI_VERSION = '1.3.0';
const skill = readFileSync(SKILL_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};
const claudePlugin = JSON.parse(readFileSync(CLAUDE_PLUGIN_PATH, 'utf8')) as Record<string, unknown>;
const claudeMarketplace = JSON.parse(readFileSync(CLAUDE_MARKETPLACE_PATH, 'utf8')) as {
  name: string;
  plugins: Array<Record<string, unknown>>;
};

interface SkillFrontmatter {
  name: string;
  description: string;
  compatibility: string;
  license: string;
  metadata: {
    author: string;
    version: string;
  };
  'allowed-tools'?: unknown;
}

function parseFrontmatter(markdown: string): SkillFrontmatter {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(markdown);
  if (!match?.[1]) throw new Error('SKILL.md must start with YAML frontmatter');
  return load(match[1]) as SkillFrontmatter;
}

function tableContainsCode(markdown: string, value: string): boolean {
  return markdown
    .split('\n')
    .some(line => line.split('|').some(cell => cell.trim() === `\`${value}\``));
}

describe('lingua-verify Agent Skill', () => {
  const frontmatter = parseFrontmatter(skill);

  it('uses a portable skill identity aligned with the package', () => {
    expect(frontmatter.name).toBe(basename(dirname(SKILL_PATH)));
    expect(frontmatter.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(frontmatter.description.length).toBeGreaterThan(1);
    expect(frontmatter.description.length).toBeLessThanOrEqual(1024);
    expect(frontmatter.compatibility).toContain(`CLI ${MINIMUM_CLI_VERSION}`);
    expect(frontmatter.compatibility).toContain('target language runtime');
    expect(frontmatter.license).toBe(
      'SEE LICENSE IN https://github.com/johnny4young/lingua/blob/main/LICENSE'
    );
    expect(frontmatter.metadata).toEqual({
      author: 'johnny4young',
      version: packageJson.version,
    });
    expect(skill).toContain(`Require version ${MINIMUM_CLI_VERSION} or later`);
    expect(frontmatter['allowed-tools']).toBeUndefined();
  });

  it('only documents commands and flags owned by the CLI catalog', () => {
    for (const commandId of [
      'run',
      'capsule-validate',
      'capsule-replay',
      'list-utilities',
      'utility',
    ]) {
      const command = CLI_HELP_CATALOG.commands.find(candidate => candidate.id === commandId);
      expect(command, commandId).toBeDefined();
      const prefix = command!.invocation
        .split(' [')[0]!
        .replaceAll(/<[^>]+>/gu, '')
        .trim();
      expect(skill, `skill must document ${commandId}`).toContain(prefix);
    }

    for (const flagId of ['input', 'timeout', 'env', 'json', 'separator']) {
      const flag = CLI_HELP_CATALOG.flags.find(candidate => candidate.id === flagId);
      expect(flag, flagId).toBeDefined();
      const marker = flagId === 'separator' ? '`--`' : flag!.syntax.split(' ')[0]!;
      expect(skill, `skill must document ${flagId}`).toContain(marker);
    }
  });

  it('pins every stable exit code and the Capsule drift exception', () => {
    for (const code of Object.values(CLI_EXIT_CODES)) {
      expect(tableContainsCode(skill, String(code))).toBe(true);
    }
    expect(skill).toContain('comparison.matches: false');
    expect(skill).toContain('output drift');
  });

  it('preserves the local-execution safety boundary', () => {
    expect(skill).toContain('They are not sandboxes.');
    expect(skill).toContain("never install software without the user's approval");
    expect(skill).toContain('Capsule validation is non-executing');
    expect(skill).toContain('Capsule replay is executing');
    expect(skill).toContain('Do not use shell interpolation');
    expect(skill).toContain('Standalone Windows/Linux x64 builds');
    expect(skill).toContain('`python`/`py`/`python3` on Windows');

    const bashBlocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/gu)].flatMap(match =>
      match[1]!.trim().split('\n')
    );
    expect(bashBlocks.length).toBeGreaterThan(0);
    expect(bashBlocks.every(line => line.startsWith('lingua '))).toBe(true);
    expect(existsSync(resolve(ROOT, 'skills/lingua-verify/mcp.json'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'skills/lingua-verify/hooks.json'))).toBe(false);
  });
});

describe('native Claude Code distribution', () => {
  it('publishes the skills directory as a version-aligned native plugin', () => {
    expect(claudePlugin).toMatchObject({
      name: 'lingua',
      displayName: 'Lingua CLI Verification',
      version: packageJson.version,
      repository: 'https://github.com/johnny4young/lingua',
      skills: './',
    });
    expect(Object.keys(claudePlugin)).not.toContain('agents');
    expect(Object.keys(claudePlugin)).not.toContain('hooks');
    expect(Object.keys(claudePlugin)).not.toContain('mcpServers');
    expect(Object.keys(claudePlugin)).not.toContain('lspServers');
    expect(readFileSync(resolve(ROOT, 'skills/LICENSE'), 'utf8')).toBe(
      readFileSync(resolve(ROOT, 'LICENSE'), 'utf8')
    );
  });

  it('publishes a sparse marketplace entry for the native plugin', () => {
    expect(claudeMarketplace.name).toBe('linguacode');
    expect(claudeMarketplace.plugins).toHaveLength(1);
    expect(claudeMarketplace.plugins[0]).toMatchObject({
      name: 'lingua',
      version: packageJson.version,
      source: {
        source: 'git-subdir',
        url: 'johnny4young/lingua',
        path: 'skills',
      },
    });
  });
});
