/**
 * RL-039 Slice B — Recipe `js-count-vowels`.
 *
 * Count vowels in a string. Beginner-friendly; first recipe many
 * new users open.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-count-vowels',
  language: 'javascript',
  title: {
    en: 'Count vowels in a string',
    es: 'Cuenta vocales en un string',
  },
  prompt: {
    en:
      'Write `countVowels(text)` that returns how many vowels (a / e / i / o / u) appear in ' +
      '`text`, case-insensitive.\n\n' +
      'Export the function as `countVowels`.',
    es:
      'Escribe `countVowels(text)` que devuelva cuántas vocales (a / e / i / o / u) aparecen en ' +
      '`text`, ignorando mayúsculas.\n\n' +
      'Exporta la función como `countVowels`.',
  },
  starterCode: [
    '// TODO: implement countVowels(text).',
    'function countVowels(text) {',
    '  return 0; // <-- replace this',
    '}',
    '',
    'console.log(countVowels("Hello world"));',
  ].join('\n'),
  assertions: [
    {
      id: 'hello-world',
      name: { en: '`Hello world` → 3', es: '`Hello world` → 3' },
      kind: 'value',
      code: 'countVowels("Hello world") === 3',
      hint: {
        en: 'A simple loop over each char + `if "aeiou".includes(...)` does it.',
        es: 'Un loop simple sobre cada char + `if "aeiou".includes(...)` lo hace.',
      },
    },
    {
      id: 'case-insensitive',
      name: { en: 'Case-insensitive (`AaEe` → 4)', es: 'Insensible a mayúsculas (`AaEe` → 4)' },
      kind: 'value',
      code: 'countVowels("AaEe") === 4',
    },
    {
      id: 'no-vowels',
      name: { en: 'No vowels returns 0', es: 'Sin vocales devuelve 0' },
      kind: 'value',
      code: 'countVowels("rhythm") === 0',
    },
  ],
  tags: ['strings', 'beginner', 'iteration'],
};
