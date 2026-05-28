/**
 * RL-100 Slice 1 — Importer registry unit tests.
 *
 * Pins the closed enum + the basic registry contract (Slice 2+
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

  it('Slice 2 ships curl-http + ipynb-notebook', () => {
    expect([...IMPORTER_IDS].sort()).toEqual(['curl-http', 'ipynb-notebook']);
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

  it('returns null when nothing claims the input', () => {
    expect(detectImporter('GET / HTTP/1.1')).toBeNull();
  });
});
