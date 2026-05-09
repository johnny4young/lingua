import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVELOPER_UTILITIES } from '../../src/renderer/data/developerUtilities';
import { DEVELOPER_UTILITY_PANEL_COMPONENTS } from '../../src/renderer/components/DeveloperUtilities/UtilityPanels';

const ROUTER_PATH = resolve(
  __dirname,
  '../../src/renderer/components/DeveloperUtilities/UtilityPanels.tsx'
);

describe('DeveloperUtilityPanel registry', () => {
  it('maps every utility catalog id to a panel component', () => {
    const catalogIds = DEVELOPER_UTILITIES.map((utility) => utility.id).sort();
    const registryIds = Object.keys(DEVELOPER_UTILITY_PANEL_COMPONENTS).sort();

    expect(registryIds).toEqual(catalogIds);
  });

  it('keeps the router as a small registry instead of a panel implementation dump', () => {
    const source = readFileSync(ROUTER_PATH, 'utf-8');
    const lineCount = source.split('\n').length;

    expect(lineCount).toBeLessThanOrEqual(180);
    expect(source).not.toContain('useState(');
    expect(source).not.toContain('useEffect(');
    expect(source).not.toContain('useMemo(');
  });
});
