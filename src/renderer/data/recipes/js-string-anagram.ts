/**
 * implementation — Recipe `js-string-anagram`.
 *
 * Detect anagrams of two strings. Exercises char-frequency hashing
 * or sort-and-compare. Tests check casing + spaces.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-string-anagram',
  language: 'javascript',
  title: {
    en: 'Detect string anagrams',
    es: 'Detecta anagramas de strings',
  },
  prompt: {
    en:
      'Write a function `isAnagram(a, b)` that returns `true` when `a` and `b` are anagrams ' +
      'of each other, ignoring case and whitespace. `"Listen"` and `"Silent"` are anagrams; ' +
      '`"hello"` and `"world"` are not.\n\n' +
      'Export the function as `isAnagram`.',
    es:
      'Escribe una función `isAnagram(a, b)` que devuelva `true` cuando `a` y `b` son anagramas, ' +
      'ignorando mayúsculas y espacios. `"Listen"` y `"Silent"` son anagramas; ' +
      '`"hello"` y `"world"` no.\n\n' +
      'Exporta la función como `isAnagram`.',
  },
  starterCode: [
    '// TODO: implement isAnagram(a, b).',
    'function isAnagram(a, b) {',
    '  return false; // <-- replace this',
    '}',
    '',
    'console.log(isAnagram("Listen", "Silent"));',
    'console.log(isAnagram("hello", "world"));',
  ].join('\n'),
  assertions: [
    {
      id: 'positive-case',
      name: { en: '`Listen` / `Silent` returns true', es: '`Listen` / `Silent` devuelve true' },
      kind: 'value',
      code: 'isAnagram("Listen", "Silent") === true',
      hint: {
        en: 'Normalise to lower case + sort the chars, then compare.',
        es: 'Normaliza a minúsculas + ordena los caracteres y compara.',
      },
    },
    {
      id: 'negative-case',
      name: { en: '`hello` / `world` returns false', es: '`hello` / `world` devuelve false' },
      kind: 'value',
      code: 'isAnagram("hello", "world") === false',
    },
    {
      id: 'ignores-whitespace',
      name: {
        en: 'Ignores whitespace (`Dormitory` / `Dirty room`)',
        es: 'Ignora espacios (`Dormitory` / `Dirty room`)',
      },
      kind: 'value',
      code: 'isAnagram("Dormitory", "Dirty room") === true',
    },
  ],
  tags: ['strings', 'sorting', 'normalization'],
};
