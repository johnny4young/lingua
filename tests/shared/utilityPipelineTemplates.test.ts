/**
 * RL-099 Slice 5 — pipeline template catalog + instantiate tests,
 * including the fold-D registry/i18n completeness guard.
 */

import { describe, expect, it } from 'vitest';
import {
  PIPELINE_TEMPLATES,
  PIPELINE_TEMPLATE_IDS,
  getPipelineTemplate,
  instantiatePipelineTemplate,
} from '../../src/shared/utilityPipelineTemplates';
import { getAdapter } from '../../src/shared/utilities/registry';
import { parsePipeline } from '../../src/shared/utilityPipeline';
import enCommon from '../../src/renderer/i18n/locales/en/common.json';
import esCommon from '../../src/renderer/i18n/locales/es/common.json';

function camelKey(id: string): string {
  return id.replace(/-([a-z])/gu, (_m, c: string) => c.toUpperCase());
}

describe('PIPELINE_TEMPLATES catalog', () => {
  it('exposes exactly the closed-enum ids', () => {
    expect(PIPELINE_TEMPLATES.map((t) => t.id).sort()).toEqual(
      [...PIPELINE_TEMPLATE_IDS].sort()
    );
  });

  it('every step references a registered adapter with valid options', () => {
    for (const template of PIPELINE_TEMPLATES) {
      expect(template.steps.length).toBeGreaterThan(0);
      for (const step of template.steps) {
        const adapter = getAdapter(step.utilityId);
        expect(adapter, `${template.id} → ${step.utilityId}`).toBeTruthy();
        if (step.options) {
          // Spelled-out options must survive the adapter's own guard.
          expect(
            adapter?.parseOptions(step.options),
            `${template.id} → ${step.utilityId} options`
          ).not.toBeNull();
        }
      }
    }
  });

  it('getPipelineTemplate resolves known ids and rejects unknown', () => {
    expect(getPipelineTemplate('slugify')?.id).toBe('slugify');
    expect(getPipelineTemplate('does-not-exist')).toBeUndefined();
  });
});

describe('instantiatePipelineTemplate', () => {
  it('builds a schema-valid pipeline with the template steps', () => {
    const template = getPipelineTemplate('url-decode-json')!;
    const pipeline = instantiatePipelineTemplate(template, {
      pipelineId: 'pipe-1',
      stepIds: ['s1', 's2'],
      name: 'URL decode to JSON',
      now: '2026-06-19T00:00:00.000Z',
    });
    // Round-trips through the persisted-shape validator.
    expect(parsePipeline(pipeline)).not.toBeNull();
    expect(pipeline.id).toBe('pipe-1');
    expect(pipeline.name).toBe('URL decode to JSON');
    expect(pipeline.steps.map((s) => s.utilityId)).toEqual([
      'url-decode',
      'json-format',
    ]);
    expect(pipeline.steps.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('applies spelled-out options (slugify → kebab)', () => {
    const template = getPipelineTemplate('slugify')!;
    const pipeline = instantiatePipelineTemplate(template, {
      pipelineId: 'pipe-2',
      stepIds: ['s1'],
      name: 'Slugify',
    });
    expect(pipeline.steps[0]!.options).toEqual({ target: 'kebab' });
  });

  it('synthesizes step ids deterministically when under-supplied', () => {
    const template = getPipelineTemplate('hash-base64')!;
    const pipeline = instantiatePipelineTemplate(template, {
      pipelineId: 'pipe-3',
      stepIds: [], // caller under-supplied
      name: 'Hash + Base64',
    });
    expect(pipeline.steps).toHaveLength(2);
    const ids = pipeline.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(2); // unique
    expect(ids[0]).toContain('pipe-3');
  });

  it('every catalog template instantiates to a valid pipeline', () => {
    for (const template of PIPELINE_TEMPLATES) {
      const pipeline = instantiatePipelineTemplate(template, {
        pipelineId: `p-${template.id}`,
        stepIds: template.steps.map((_s, i) => `p-${template.id}-${i}`),
        name: template.id,
      });
      expect(parsePipeline(pipeline), template.id).not.toBeNull();
    }
  });
});

// Fold D — every template id carries name + description in both locales.
describe('template i18n completeness (RL-099 Slice 5 fold D)', () => {
  const en = enCommon as Record<string, string>;
  const es = esCommon as Record<string, string>;

  it('gallery chrome keys exist in both locales', () => {
    for (const key of [
      'utilityPipeline.template.galleryTitle',
      'utilityPipeline.template.galleryBody',
      'utilityPipeline.template.useButton',
    ]) {
      expect(en[key], `${key} (en)`).toBeTruthy();
      expect(es[key], `${key} (es)`).toBeTruthy();
    }
  });

  it('every template has name + description in both locales', () => {
    for (const template of PIPELINE_TEMPLATES) {
      const base = `utilityPipeline.template.${camelKey(template.id)}`;
      expect(en[`${base}.name`], `${base}.name (en)`).toBeTruthy();
      expect(en[`${base}.description`], `${base}.description (en)`).toBeTruthy();
      expect(es[`${base}.name`], `${base}.name (es)`).toBeTruthy();
      expect(es[`${base}.description`], `${base}.description (es)`).toBeTruthy();
      // The nameKey/descriptionKey the catalog declares must match.
      expect(template.nameKey).toBe(`${base}.name`);
      expect(template.descriptionKey).toBe(`${base}.description`);
    }
  });
});
