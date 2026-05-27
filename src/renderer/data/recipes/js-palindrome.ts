/**
 * RL-039 Slice B — Recipe `js-palindrome`.
 *
 * Detect palindromes. Exercises string normalization + reverse-and-
 * compare. Tests cover punctuation + casing.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-palindrome',
  language: 'javascript',
  title: {
    en: 'Detect palindromes',
    es: 'Detecta palíndromos',
  },
  prompt: {
    en:
      'Write `isPalindrome(text)` that returns `true` when `text` reads the same forwards and ' +
      'backwards, ignoring case, spaces, and punctuation. `"A man, a plan, a canal: Panama"` is ' +
      'a palindrome.\n\n' +
      'Export the function as `isPalindrome`.',
    es:
      'Escribe `isPalindrome(text)` que devuelva `true` cuando `text` se lee igual al derecho y ' +
      'al revés, ignorando mayúsculas, espacios y puntuación. `"A man, a plan, a canal: Panama"` ' +
      'es un palíndromo.\n\n' +
      'Exporta la función como `isPalindrome`.',
  },
  starterCode: [
    '// TODO: implement isPalindrome(text).',
    'function isPalindrome(text) {',
    '  return false; // <-- replace this',
    '}',
    '',
    'console.log(isPalindrome("A man, a plan, a canal: Panama"));',
    'console.log(isPalindrome("hello"));',
  ].join('\n'),
  assertions: [
    {
      id: 'classic-palindrome',
      name: {
        en: '`A man, a plan, a canal: Panama` is a palindrome',
        es: '`A man, a plan, a canal: Panama` es palíndromo',
      },
      kind: 'value',
      code: 'isPalindrome("A man, a plan, a canal: Panama") === true',
      hint: {
        en: 'Strip non-alphanumerics with `.replace(/[^a-z0-9]/gi, "")`, lowercase, compare to reverse.',
        es: 'Quita los no-alfanuméricos con `.replace(/[^a-z0-9]/gi, "")`, pasa a minúsculas y compara con el reverso.',
      },
    },
    {
      id: 'not-palindrome',
      name: { en: '`hello` is not a palindrome', es: '`hello` no es palíndromo' },
      kind: 'value',
      code: 'isPalindrome("hello") === false',
    },
    {
      id: 'single-char',
      name: { en: 'Single char is a palindrome', es: 'Un solo carácter es palíndromo' },
      kind: 'value',
      code: 'isPalindrome("z") === true',
    },
  ],
  tags: ['strings', 'normalization', 'reverse'],
};
