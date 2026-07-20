/** implementation — Recipe `ts-discriminated-union-area`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'ts-discriminated-union-area',
  language: 'typescript',
  title: {
    en: 'Calculate area from a discriminated union',
    es: 'Calcula áreas con una unión discriminada',
  },
  prompt: {
    en:
      'Complete `area(shape)` for every member of the `Shape` union. Narrow with the `kind` discriminant and return the area for circles, rectangles, and triangles.\n\n' +
      'Keep the `never` check so adding a new shape later creates a useful TypeScript error.',
    es:
      'Completa `area(shape)` para cada miembro de la unión `Shape`. Usa el discriminante `kind` y devuelve el área de círculos, rectángulos y triángulos.\n\n' +
      'Conserva la comprobación con `never` para que agregar otra figura produzca un error útil de TypeScript.',
  },
  starterCode: [
    'type Shape =',
    '  | { kind: "circle"; radius: number }',
    '  | { kind: "rectangle"; width: number; height: number }',
    '  | { kind: "triangle"; base: number; height: number };',
    '',
    'function area(shape: Shape): number {',
    '  // TODO: handle every shape kind.',
    '  const exhaustive: never = shape;',
    '  return exhaustive;',
    '}',
  ].join('\n'),
  assertions: [
    {
      id: 'circle-area',
      name: { en: 'Calculates a circle', es: 'Calcula un círculo' },
      kind: 'value',
      code:
        'Math.abs(area({ kind: "circle", radius: 2 }) - Math.PI * 4) < 1e-9',
      hint: {
        en: 'A circle uses `Math.PI * radius ** 2`.',
        es: 'Un círculo usa `Math.PI * radius ** 2`.',
      },
    },
    {
      id: 'rectangle-area',
      name: {
        en: 'Calculates a rectangle',
        es: 'Calcula un rectángulo',
      },
      kind: 'value',
      code:
        'area({ kind: "rectangle", width: 4, height: 3 }) === 12',
    },
    {
      id: 'triangle-area',
      name: { en: 'Calculates a triangle', es: 'Calcula un triángulo' },
      kind: 'value',
      code: 'area({ kind: "triangle", base: 10, height: 4 }) === 20',
    },
  ],
  tags: ['typescript', 'unions', 'narrowing'],
};
