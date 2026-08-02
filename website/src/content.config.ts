import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const seo = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/seo' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    canonical: z.url(),
    ogImage: z.string().optional(),
    language: z.enum(['go', 'rust', 'python', 'typescript', 'javascript', 'multi', 'lua']),
  }),
});

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(180),
    order: z.number().default(99),
    section: z.enum(['guide', 'reference']).default('guide'),
  }),
});

const cli = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/cli' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(180),
    order: z.number(),
    group: z.enum(['start', 'guides', 'automation', 'reference']),
    keywords: z.array(z.string()).default([]),
  }),
});

const pressKit = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/press-kit' }),
  schema: z.looseObject({}),
});

export const collections = { seo, docs, cli, pressKit };
