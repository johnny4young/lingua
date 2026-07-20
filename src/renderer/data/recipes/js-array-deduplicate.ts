/**
 * implementation — Recipe `js-array-deduplicate`.
 *
 * Remove duplicate primitives from an array preserving first-seen
 * order. Exercises `Set` round-trip + iteration order.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-array-deduplicate',
  language: 'javascript',
  title: {
    en: 'Remove duplicates from an array',
    es: 'Elimina duplicados de un arreglo',
  },
  prompt: {
    en:
      'Given an array of strings and numbers, return a NEW array with duplicates removed, ' +
      'preserving the order of the FIRST occurrence of each value.\n\n' +
      'Export the deduplicated array as `unique`.',
    es:
      'Dado un arreglo de strings y números, devuelve un arreglo NUEVO sin duplicados, ' +
      'preservando el orden de la PRIMERA aparición de cada valor.\n\n' +
      'Exporta el arreglo deduplicado como `unique`.',
  },
  starterCode: [
    'const items = ["pear", 1, "apple", 1, "pear", 2, "kiwi"];',
    '',
    '// TODO: produce a deduped array preserving first-seen order.',
    'const unique = items; // <-- replace this',
    '',
    'console.log(unique);',
  ].join('\n'),
  assertions: [
    {
      id: 'correct-length',
      name: { en: 'Result has 5 entries', es: 'El resultado tiene 5 entradas' },
      kind: 'value',
      code: 'Array.isArray(unique) && unique.length === 5',
    },
    {
      id: 'preserves-order',
      name: {
        en: 'First-seen order is preserved',
        es: 'El orden de primera aparición se preserva',
      },
      kind: 'value',
      code: 'JSON.stringify(unique) === JSON.stringify(["pear", 1, "apple", 2, "kiwi"])',
      hint: {
        en: '`new Set(items)` keeps insertion order. Spread it back into an array.',
        es: '`new Set(items)` mantiene el orden de inserción. Esparce de vuelta a un arreglo.',
      },
    },
    {
      id: 'no-mutation',
      name: { en: 'Source array is not mutated', es: 'El arreglo original no se muta' },
      kind: 'value',
      code: 'items.length === 7 && items[3] === 1 && items[4] === "pear"',
    },
  ],
  tags: ['arrays', 'set', 'order'],
};
