/**
 * implementation — Recipe `js-object-deep-clone`.
 *
 * Deep-clone a nested object. Exercises structuredClone vs hand-
 * rolled recursion; tests prove independence of the clone.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-object-deep-clone',
  language: 'javascript',
  title: {
    en: 'Deep-clone a nested object',
    es: 'Clona profundamente un objeto anidado',
  },
  prompt: {
    en:
      'Write `deepClone(value)` that returns a deep copy of any plain-object / array / primitive ' +
      'graph. Mutations to the clone must NOT touch the original.\n\n' +
      'Export the function as `deepClone`.',
    es:
      'Escribe `deepClone(value)` que devuelva una copia profunda de cualquier grafo de objetos ' +
      'planos / arreglos / primitivos. Las mutaciones al clon NO deben tocar el original.\n\n' +
      'Exporta la función como `deepClone`.',
  },
  starterCode: [
    '// TODO: implement deepClone(value).',
    'function deepClone(value) {',
    '  return value; // <-- replace this',
    '}',
    '',
    'const original = { name: "lingua", tags: ["js", "ts"], nested: { count: 1 } };',
    'const copy = deepClone(original);',
    'console.log(copy);',
  ].join('\n'),
  assertions: [
    {
      id: 'shallow-equal',
      name: { en: 'Clone is structurally equal to the source', es: 'El clon es estructuralmente igual al original' },
      kind: 'value',
      code:
        'JSON.stringify(deepClone({ a: 1, b: [2, 3] })) === JSON.stringify({ a: 1, b: [2, 3] })',
      hint: {
        en: 'On modern engines `structuredClone(value)` is a one-liner.',
        es: 'En engines modernos `structuredClone(value)` es un one-liner.',
      },
    },
    {
      id: 'no-shared-nested-ref',
      name: { en: 'Mutating the clone does NOT touch the original', es: 'Mutar el clon NO afecta el original' },
      kind: 'value',
      code:
        '(() => { const src = { nested: { x: 1 } }; const c = deepClone(src); c.nested.x = 99; return src.nested.x === 1; })()',
    },
    {
      id: 'no-shared-array-ref',
      name: { en: 'Nested arrays are independent', es: 'Los arreglos anidados son independientes' },
      kind: 'value',
      code:
        '(() => { const src = { list: [1, 2] }; const c = deepClone(src); c.list.push(3); return src.list.length === 2; })()',
    },
  ],
  tags: ['objects', 'clone', 'recursion'],
};
