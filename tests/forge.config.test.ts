// @vitest-environment node

import { describe, expect, it } from 'vitest';
import forgeConfig from '../forge.config';

describe('forge config', () => {
  it('sets the desktop app category metadata', () => {
    expect(forgeConfig.packagerConfig.appCategoryType).toBe(
      'public.app-category.developer-tools'
    );
  });

  it('registers the lingua protocol in packaged app metadata', () => {
    expect(forgeConfig.packagerConfig.protocols).toEqual([
      {
        name: 'Lingua',
        schemes: ['lingua'],
      },
    ]);
  });
});
