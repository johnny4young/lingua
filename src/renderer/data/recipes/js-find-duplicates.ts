/**
 * implementation — Recipe `js-find-duplicates`.
 *
 * Find duplicate entries in an array. Exercises `Map` counting + the
 * insertion-order-of-first-occurrence subtlety.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-find-duplicates',
  language: 'javascript',
  title: {
    en: 'Find duplicate entries',
    es: 'Encuentra entradas duplicadas',
  },
  prompt: {
    en:
      'Write `findDuplicates(arr)` that returns a NEW array containing each value that appears ' +
      'more than once in `arr`. The result has one entry per duplicate value (no triple-listing) ' +
      'and uses the order of first repeated occurrence.\n\n' +
      '`findDuplicates([1, 2, 3, 2, 4, 1])` returns `[2, 1]`.\n\n' +
      'Export the function as `findDuplicates`.',
    es:
      'Escribe `findDuplicates(arr)` que devuelva un arreglo NUEVO con cada valor que aparece ' +
      'más de una vez en `arr`. El resultado tiene una entrada por valor duplicado (sin triplicar) ' +
      'y usa el orden de la primera repetición.\n\n' +
      '`findDuplicates([1, 2, 3, 2, 4, 1])` devuelve `[2, 1]`.\n\n' +
      'Exporta la función como `findDuplicates`.',
  },
  starterCode: [
    '// TODO: implement findDuplicates(arr).',
    'function findDuplicates(arr) {',
    '  return []; // <-- replace this',
    '}',
    '',
    'console.log(findDuplicates([1, 2, 3, 2, 4, 1]));',
  ].join('\n'),
  assertions: [
    {
      id: 'basic-case',
      name: { en: '`[1, 2, 3, 2, 4, 1]` → `[2, 1]`', es: '`[1, 2, 3, 2, 4, 1]` → `[2, 1]`' },
      kind: 'value',
      code: 'JSON.stringify(findDuplicates([1, 2, 3, 2, 4, 1])) === JSON.stringify([2, 1])',
      hint: {
        en: 'Track first-seen counts in a `Map`; emit when count flips to 2.',
        es: 'Lleva un conteo en `Map`; emite cuando el contador pase a 2.',
      },
    },
    {
      id: 'no-duplicates',
      name: { en: 'Unique array returns []', es: 'Arreglo único devuelve []' },
      kind: 'value',
      code: 'JSON.stringify(findDuplicates([1, 2, 3])) === JSON.stringify([])',
    },
    {
      id: 'one-entry-per-duplicate',
      name: { en: 'No triple-listing', es: 'Sin triplicar entradas' },
      kind: 'value',
      code: 'JSON.stringify(findDuplicates([1, 1, 1, 1])) === JSON.stringify([1])',
    },
  ],
  tags: ['arrays', 'map', 'counting'],
};
