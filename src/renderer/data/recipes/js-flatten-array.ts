/**
 * RL-039 Slice B — Recipe `js-flatten-array`.
 *
 * Recursively flatten a nested array. Exercises recursion vs the
 * built-in `Array.prototype.flat(Infinity)` decision.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-flatten-array',
  language: 'javascript',
  title: {
    en: 'Recursively flatten a nested array',
    es: 'Aplana recursivamente un arreglo anidado',
  },
  prompt: {
    en:
      'Given an arbitrarily nested array of integers, return a flat array containing every ' +
      'integer in left-to-right order. The depth is unbounded so `arr.flat(1)` is NOT enough.\n\n' +
      'Export the flat array as `flat`.',
    es:
      'Dado un arreglo de enteros anidado a profundidad arbitraria, devuelve un arreglo plano ' +
      'con cada entero en orden izquierda-a-derecha. La profundidad es ilimitada, así que ' +
      '`arr.flat(1)` NO es suficiente.\n\n' +
      'Exporta el arreglo plano como `flat`.',
  },
  starterCode: [
    'const nested = [1, [2, [3, [4, [5, 6]], 7], 8], 9];',
    '',
    '// TODO: produce a flat array of every integer.',
    'const flat = nested; // <-- replace this',
    '',
    'console.log(flat);',
  ].join('\n'),
  assertions: [
    {
      id: 'all-integers-present',
      name: { en: 'Every integer is present', es: 'Todos los enteros están presentes' },
      kind: 'value',
      code: 'JSON.stringify(flat) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9])',
      hint: {
        en: '`nested.flat(Infinity)` is the one-liner; or recurse with `reduce`.',
        es: '`nested.flat(Infinity)` es el one-liner; o recurre con `reduce`.',
      },
    },
    {
      id: 'depth-unbounded',
      name: {
        en: 'Works on a 5-deep nesting',
        es: 'Funciona con anidación de profundidad 5',
      },
      kind: 'value',
      code: '!flat.some((entry) => Array.isArray(entry))',
    },
    {
      id: 'preserves-order',
      name: { en: 'Left-to-right order preserved', es: 'Orden izquierda-derecha preservado' },
      kind: 'value',
      code: 'flat[0] === 1 && flat[flat.length - 1] === 9',
    },
  ],
  tags: ['arrays', 'recursion', 'flat'],
};
