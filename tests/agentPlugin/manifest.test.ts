import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};
const plugin = JSON.parse(readFileSync(resolve(ROOT, 'plugin.json'), 'utf8')) as Record<
  string,
  unknown
>;

describe('public agent plugin manifest', () => {
  it('uses the Agent Plugins 1.0 contract and the product version', () => {
    expect(plugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(plugin.name).toBe('lingua');
    expect(plugin.version).toBe(packageJson.version);
    expect(plugin.license).toBe('SEE LICENSE IN LICENSE');
    expect(plugin.repository).toBe('https://github.com/johnny4young/lingua');
    expect(plugin.homepage).toBe('https://linguacode.dev/cli/ai-agents');
  });

  it('keeps the root manifest intentionally instruction-only', () => {
    expect(Object.keys(plugin).sort()).toEqual(
      [
        '$schema',
        'author',
        'description',
        'homepage',
        'keywords',
        'license',
        'name',
        'repository',
        'version',
      ].sort()
    );
    expect(plugin).not.toHaveProperty('hooks');
    expect(plugin).not.toHaveProperty('mcpServers');
    // VS Code's plugin-format auto-detection reads hooks and MCP config from
    // more locations than the Agent Plugins 1.0 root files: hooks come from
    // com.github.copilot/hooks/hooks.json (Agent Plugins 1.0), hooks/hooks.json
    // (Claude format), or hooks.json (Copilot format), and MCP servers from
    // mcp.json or .mcp.json. Pin every discovery path so a hook or server
    // added anywhere cannot leave this instruction-only gate green.
    expect(existsSync(resolve(ROOT, 'mcp.json'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'hooks.json'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'hooks'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'com.github.copilot'))).toBe(false);
    // .mcp.json is legitimate as LOCAL maintainer tooling (gitignored Claude
    // Code MCP config), so gate what ships instead of what is on disk: the
    // path must never be tracked by git.
    expect(execSync('git ls-files -- .mcp.json', { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('');
  });

  it('discovers a public skill without publishing private maintainer skills', () => {
    expect(existsSync(resolve(ROOT, 'skills/lingua-verify/SKILL.md'))).toBe(true);

    const releasePolicy = readFileSync(resolve(ROOT, 'docs/PUBLIC_RELEASE_CHECKLIST.md'), 'utf8');
    expect(releasePolicy).toContain('plugin.json');
    expect(releasePolicy).toContain('.claude-plugin/marketplace.json');
    expect(releasePolicy).toContain('skills/.claude-plugin/plugin.json');
    expect(releasePolicy).toContain('skills/LICENSE');
    expect(releasePolicy).toContain('skills/lingua-verify/');
    expect(releasePolicy).toContain('.agents/');
    expect(releasePolicy).toContain('private maintainer command skills');

    const integrationGuide = readFileSync(resolve(ROOT, 'docs/AGENT_INTEGRATION.md'), 'utf8');
    expect(integrationGuide).toMatch(/^### Codex$/mu);
    expect(integrationGuide).not.toMatch(/^### ChatGPT/u);
  });
});
