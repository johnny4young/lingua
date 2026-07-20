/**
 * implementation — Importer registry unit tests.
 *
 * Pins the closed enum + the basic registry contract (implementation
 * adapters extend the same shape; renaming the API here breaks
 * downstream importers).
 */

import { describe, expect, it } from 'vitest';
import {
  IMPORTER_REGISTRY,
  detectImporter,
  getImporter,
  listImporters,
} from '../../../src/shared/importers/registry';
import { IMPORTER_IDS } from '../../../src/shared/importers/types';

describe('IMPORTER_REGISTRY', () => {
  it('exposes the closed-enum id surface', () => {
    expect(Object.keys(IMPORTER_REGISTRY).sort()).toEqual(
      [...IMPORTER_IDS].sort()
    );
  });

  it('ships curl-http + ipynb-notebook + postman/bruno collections + linguanb ', () => {
    expect([...IMPORTER_IDS].sort()).toEqual([
      'bruno-collection',
      'curl-http',
      'ipynb-notebook',
      'linguanb-notebook',
      'postman-collection',
    ]);
  });

  it('lists linguanb-notebook BEFORE ipynb-notebook so its specific detect wins', () => {
    // A `.linguanb` envelope embeds an inner `"cells":` array that the
    // ipynb adapter would otherwise claim; registry order routes the
    // specific `format` marker first.
    const ids = Object.keys(IMPORTER_REGISTRY);
    expect(ids.indexOf('linguanb-notebook')).toBeLessThan(
      ids.indexOf('ipynb-notebook')
    );
  });
});

describe('getImporter', () => {
  it('returns the cURL adapter for "curl-http"', () => {
    const adapter = getImporter('curl-http');
    expect(adapter?.id).toBe('curl-http');
  });

  it('returns the ipynb adapter for "ipynb-notebook"', () => {
    const adapter = getImporter('ipynb-notebook');
    expect(adapter?.id).toBe('ipynb-notebook');
  });

  it('returns the postman + bruno adapters', () => {
    expect(getImporter('postman-collection')?.id).toBe('postman-collection');
    expect(getImporter('bruno-collection')?.id).toBe('bruno-collection');
  });

  it('returns undefined for unknown ids', () => {
    expect(getImporter('not-a-real-id')).toBeUndefined();
  });
});

describe('listImporters', () => {
  it('enumerates every registered adapter', () => {
    const adapters = listImporters();
    expect(adapters).toHaveLength(IMPORTER_IDS.length);
  });
});

describe('detectImporter', () => {
  it('auto-picks curl-http for cURL input', () => {
    expect(detectImporter('curl https://example.com')).toBe('curl-http');
  });

  it('auto-picks ipynb-notebook for a Jupyter v4 JSON payload', () => {
    expect(
      detectImporter('{ "nbformat": 4, "cells": [] }')
    ).toBe('ipynb-notebook');
  });

  it('auto-picks postman-collection for a v2.1 collection JSON', () => {
    expect(
      detectImporter(
        '{ "info": { "schema": "v2.1.0" }, "item": [{ "request": { "method": "GET", "url": "https://x.dev" } }] }'
      )
    ).toBe('postman-collection');
  });

  it('auto-picks bruno-collection for a .bru request file', () => {
    expect(
      detectImporter('get {\n  url: https://x.dev\n}\n')
    ).toBe('bruno-collection');
  });

  it('returns null when nothing claims the input', () => {
    expect(detectImporter('GET / HTTP/1.1')).toBeNull();
  });
});
