/** implementation — Recipe `ts-group-by-property`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'ts-group-by-property',
  language: 'typescript',
  title: {
    en: 'Group typed records by a property',
    es: 'Agrupa registros tipados por una propiedad',
  },
  prompt: {
    en:
      'Implement the generic `groupBy(items, getKey)` helper. Each key must map to an array containing the matching items, in their original order.\n\n' +
      'Use `PropertyKey` so string, number, and symbol keys remain valid.',
    es:
      'Implementa el helper genérico `groupBy(items, getKey)`. Cada clave debe apuntar a un arreglo con los elementos correspondientes, en su orden original.\n\n' +
      'Usa `PropertyKey` para admitir claves string, number y symbol.',
  },
  starterCode: [
    'type Transaction = { id: number; category: "food" | "travel"; amount: number };',
    '',
    'function groupBy<T, K extends PropertyKey>(',
    '  items: readonly T[],',
    '  getKey: (item: T) => K',
    '): Record<K, T[]> {',
    '  // TODO: collect each item under its key.',
    '  return {} as Record<K, T[]>;',
    '}',
    '',
    'const transactions: Transaction[] = [',
    '  { id: 1, category: "food", amount: 12 },',
    '  { id: 2, category: "travel", amount: 45 },',
    '  { id: 3, category: "food", amount: 8 },',
    '];',
    'const byCategory = groupBy(transactions, (item) => item.category);',
  ].join('\n'),
  assertions: [
    {
      id: 'creates-both-groups',
      name: {
        en: 'Creates food and travel groups',
        es: 'Crea los grupos food y travel',
      },
      kind: 'value',
      code:
        'Array.isArray(byCategory.food) && Array.isArray(byCategory.travel)',
      hint: {
        en: 'Create an empty array the first time a key appears.',
        es: 'Crea un arreglo vacío la primera vez que aparezca una clave.',
      },
    },
    {
      id: 'preserves-group-order',
      name: {
        en: 'Preserves order inside each group',
        es: 'Conserva el orden dentro de cada grupo',
      },
      kind: 'value',
      code:
        'byCategory.food.map((item) => item.id).join(",") === "1,3" && byCategory.travel[0]?.id === 2',
    },
    {
      id: 'keeps-all-records',
      name: {
        en: 'Keeps all records exactly once',
        es: 'Conserva cada registro una sola vez',
      },
      kind: 'value',
      code:
        'Object.values(byCategory).flat().length === transactions.length',
    },
  ],
  tags: ['typescript', 'generics', 'arrays'],
};
