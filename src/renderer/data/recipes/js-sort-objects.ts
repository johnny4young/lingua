/**
 * RL-039 Slice B — Recipe `js-sort-objects`.
 *
 * Sort an array of objects by a key with a tie-breaker. Mid-difficulty
 * starter; exercises `Array.prototype.sort` + the stable-sort
 * guarantee + named return values.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-sort-objects',
  language: 'javascript',
  title: {
    en: 'Sort an array of objects',
    es: 'Ordena un arreglo de objetos',
  },
  prompt: {
    en:
      'Given an array of `{ name, age }` records, return a NEW array sorted by `age` ascending. ' +
      'When two records share an age, the earlier-appearing record must come first (stable sort).\n\n' +
      'Export the sorted array as `sorted`.',
    es:
      'Dado un arreglo de registros `{ name, age }`, devuelve un arreglo NUEVO ordenado por `age` ascendente. ' +
      'Cuando dos registros tienen la misma edad, el que aparece primero debe quedar primero (orden estable).\n\n' +
      'Exporta el arreglo ordenado como `sorted`.',
  },
  starterCode: [
    'const people = [',
    '  { name: "Ana", age: 31 },',
    '  { name: "Luis", age: 24 },',
    '  { name: "Marta", age: 31 },',
    '  { name: "Beto", age: 19 },',
    '];',
    '',
    '// TODO: produce a new array sorted by age ascending.',
    '// Hint: Array.prototype.sort is stable on modern engines.',
    'const sorted = people; // <-- replace this',
    '',
    'console.log(sorted);',
  ].join('\n'),
  assertions: [
    {
      id: 'returns-four-records',
      name: { en: 'Result has 4 records', es: 'El resultado tiene 4 registros' },
      kind: 'value',
      code: 'Array.isArray(sorted) && sorted.length === 4',
    },
    {
      id: 'sorted-ascending',
      name: { en: 'Records are sorted by age ascending', es: 'Los registros están ordenados por edad ascendente' },
      kind: 'value',
      code:
        'sorted.every((entry, idx) => idx === 0 || sorted[idx - 1].age <= entry.age)',
      hint: {
        en: 'Use `.sort((a, b) => a.age - b.age)` to compare numerically.',
        es: 'Usa `.sort((a, b) => a.age - b.age)` para comparar numéricamente.',
      },
    },
    {
      id: 'stable-tie-break',
      name: { en: 'Stable on ties (Ana before Marta)', es: 'Estable en empates (Ana antes que Marta)' },
      kind: 'value',
      code:
        'sorted.findIndex((p) => p.name === "Ana") < sorted.findIndex((p) => p.name === "Marta")',
      hint: {
        en: 'V8 and SpiderMonkey both ship stable sort — no manual tie-break needed.',
        es: 'V8 y SpiderMonkey traen sort estable — no necesitas un tie-break manual.',
      },
    },
  ],
  tags: ['arrays', 'sort', 'objects'],
};
