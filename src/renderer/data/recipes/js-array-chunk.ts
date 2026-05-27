/**
 * RL-039 Slice B — Recipe `js-array-chunk`.
 *
 * Chunk an array into groups of N. Exercises `slice` + iteration
 * + the off-by-one of partial-last-chunk.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-array-chunk',
  language: 'javascript',
  title: {
    en: 'Chunk an array into groups of N',
    es: 'Divide un arreglo en grupos de N',
  },
  prompt: {
    en:
      'Write `chunk(arr, size)` that splits `arr` into an array of sub-arrays, each of length ' +
      '`size` except for the final one which may be shorter.\n\n' +
      '`chunk([1,2,3,4,5], 2)` returns `[[1,2],[3,4],[5]]`.\n\n' +
      'Export the function as `chunk`.',
    es:
      'Escribe `chunk(arr, size)` que parte `arr` en un arreglo de sub-arreglos, cada uno de ' +
      'tamaño `size` excepto el último que puede ser más corto.\n\n' +
      '`chunk([1,2,3,4,5], 2)` devuelve `[[1,2],[3,4],[5]]`.\n\n' +
      'Exporta la función como `chunk`.',
  },
  starterCode: [
    '// TODO: implement chunk(arr, size).',
    'function chunk(arr, size) {',
    '  return [arr]; // <-- replace this',
    '}',
    '',
    'console.log(chunk([1, 2, 3, 4, 5], 2));',
  ].join('\n'),
  assertions: [
    {
      id: 'even-split',
      name: { en: 'Even split of 4 / 2', es: 'División uniforme de 4 / 2' },
      kind: 'value',
      code: 'JSON.stringify(chunk([1, 2, 3, 4], 2)) === JSON.stringify([[1, 2], [3, 4]])',
    },
    {
      id: 'short-last-chunk',
      name: {
        en: 'Last chunk shorter than `size`',
        es: 'El último chunk más corto que `size`',
      },
      kind: 'value',
      code:
        'JSON.stringify(chunk([1, 2, 3, 4, 5], 2)) === JSON.stringify([[1, 2], [3, 4], [5]])',
      hint: {
        en: 'Loop `i += size` and slice `arr.slice(i, i + size)`.',
        es: 'Itera `i += size` y corta `arr.slice(i, i + size)`.',
      },
    },
    {
      id: 'empty-input',
      name: { en: 'Empty input returns empty array', es: 'Entrada vacía devuelve arreglo vacío' },
      kind: 'value',
      code: 'JSON.stringify(chunk([], 3)) === JSON.stringify([])',
    },
  ],
  tags: ['arrays', 'slice', 'iteration'],
};
