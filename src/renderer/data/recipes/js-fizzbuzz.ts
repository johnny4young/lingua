/**
 * RL-039 Slice B — Recipe `js-fizzbuzz`.
 *
 * The classic FizzBuzz. Tested via `console-contains` because the
 * canonical version prints lines rather than returning a value.
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'js-fizzbuzz',
  language: 'javascript',
  title: {
    en: 'FizzBuzz from 1 to 15',
    es: 'FizzBuzz del 1 al 15',
  },
  prompt: {
    en:
      'Print numbers from 1 to 15 one per line. Replace multiples of 3 with `Fizz`, ' +
      'multiples of 5 with `Buzz`, and multiples of both with `FizzBuzz`.\n\n' +
      'No need to return a value — just `console.log` each line.',
    es:
      'Imprime los números del 1 al 15 uno por línea. Sustituye los múltiplos de 3 por `Fizz`, ' +
      'los múltiplos de 5 por `Buzz`, y los múltiplos de ambos por `FizzBuzz`.\n\n' +
      'No es necesario devolver un valor — basta con `console.log` por línea.',
  },
  starterCode: [
    '// TODO: print FizzBuzz from 1 to 15, one value per line.',
    'for (let n = 1; n <= 15; n += 1) {',
    '  console.log(n); // <-- adjust this',
    '}',
  ].join('\n'),
  assertions: [
    {
      id: 'has-fizzbuzz',
      name: { en: 'Prints `FizzBuzz` at 15', es: 'Imprime `FizzBuzz` en 15' },
      kind: 'console-contains',
      code: 'FizzBuzz',
      hint: {
        en: 'Use `if (n % 15 === 0)` before the other branches.',
        es: 'Usa `if (n % 15 === 0)` antes de las otras ramas.',
      },
    },
    {
      id: 'has-fizz',
      name: { en: 'Prints `Fizz` at 3', es: 'Imprime `Fizz` en 3' },
      kind: 'console-contains',
      code: 'Fizz\n4',
    },
    {
      id: 'has-buzz',
      name: { en: 'Prints `Buzz` at 5', es: 'Imprime `Buzz` en 5' },
      kind: 'console-contains',
      code: 'Buzz\nFizz',
    },
  ],
  tags: ['loops', 'modulo', 'control-flow'],
};
