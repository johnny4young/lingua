/** implementation — Recipe `py-sliding-window-maximum`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'py-sliding-window-maximum',
  language: 'python',
  title: {
    en: 'Find sliding-window maximums',
    es: 'Encuentra máximos en ventanas deslizantes',
  },
  prompt: {
    en:
      'Implement `sliding_window_max(values, size)` so it returns the maximum value from every contiguous window. For `[1, 3, -1, 5]` with size `2`, return `[3, 3, 5]`.\n\n' +
      'Raise `ValueError` when `size` is not between 1 and the list length.',
    es:
      'Implementa `sliding_window_max(values, size)` para devolver el máximo de cada ventana contigua. Para `[1, 3, -1, 5]` con tamaño `2`, devuelve `[3, 3, 5]`.\n\n' +
      'Lanza `ValueError` cuando `size` no esté entre 1 y el largo de la lista.',
  },
  starterCode: [
    'def sliding_window_max(values: list[int], size: int) -> list[int]:',
    '    # TODO: validate size and return one maximum per window.',
    '    return []',
    '',
    'print(sliding_window_max([1, 3, -1, 5], 2))',
  ].join('\n'),
  assertions: [
    {
      id: 'finds-each-maximum',
      name: {
        en: 'Finds each window maximum',
        es: 'Encuentra el máximo de cada ventana',
      },
      kind: 'value',
      code:
        'sliding_window_max([1, 3, -1, 5], 2) == [3, 3, 5]',
      hint: {
        en: 'Start with `max(values[i:i + size])` for each valid index.',
        es: 'Empieza con `max(values[i:i + size])` para cada índice válido.',
      },
    },
    {
      id: 'supports-size-one',
      name: {
        en: 'A size-one window returns every value',
        es: 'Una ventana de tamaño uno devuelve cada valor',
      },
      kind: 'value',
      code: 'sliding_window_max([4, 2, 9], 1) == [4, 2, 9]',
    },
    {
      id: 'supports-full-window',
      name: {
        en: 'A full-size window returns one maximum',
        es: 'Una ventana completa devuelve un máximo',
      },
      kind: 'value',
      code: 'sliding_window_max([4, 2, 9], 3) == [9]',
    },
    {
      id: 'rejects-invalid-size',
      name: {
        en: 'Rejects an invalid window size',
        es: 'Rechaza un tamaño de ventana inválido',
      },
      kind: 'throw',
      code: 'sliding_window_max([1, 2], 0)',
    },
  ],
  tags: ['python', 'algorithms', 'windows'],
};
