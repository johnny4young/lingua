/** implementation — Recipe `py-word-frequency`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'py-word-frequency',
  language: 'python',
  title: {
    en: 'Count word frequencies',
    es: 'Cuenta frecuencias de palabras',
  },
  prompt: {
    en:
      'Implement `word_frequency(text)` so it returns a dictionary of lowercase word counts. Treat punctuation as separators and ignore empty tokens.\n\n' +
      'Use only the Python standard library.',
    es:
      'Implementa `word_frequency(text)` para que devuelva un diccionario con el conteo de palabras en minúsculas. Trata la puntuación como separadores e ignora tokens vacíos.\n\n' +
      'Usa solo la biblioteca estándar de Python.',
  },
  starterCode: [
    'import re',
    '',
    'def word_frequency(text: str) -> dict[str, int]:',
    '    # TODO: normalize words and count them.',
    '    return {}',
    '',
    'print(word_frequency("Red blue red"))',
  ].join('\n'),
  assertions: [
    {
      id: 'counts-repeated-words',
      name: {
        en: 'Counts repeated words',
        es: 'Cuenta palabras repetidas',
      },
      kind: 'value',
      code:
        'word_frequency("Red blue red") == {"red": 2, "blue": 1}',
      hint: {
        en: 'Try `re.findall(r"[A-Za-z0-9]+", text.lower())`.',
        es: 'Prueba `re.findall(r"[A-Za-z0-9]+", text.lower())`.',
      },
    },
    {
      id: 'splits-punctuation',
      name: {
        en: 'Treats punctuation as separators',
        es: 'Trata la puntuación como separadores',
      },
      kind: 'value',
      code:
        'word_frequency("one, two... ONE!") == {"one": 2, "two": 1}',
    },
    {
      id: 'handles-empty-text',
      name: { en: 'Handles empty text', es: 'Maneja texto vacío' },
      kind: 'value',
      code: 'word_frequency("") == {}',
    },
  ],
  tags: ['python', 'strings', 'dictionaries'],
};
