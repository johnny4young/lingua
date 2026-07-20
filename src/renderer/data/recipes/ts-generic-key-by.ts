/** implementation — Recipe `ts-generic-key-by`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'ts-generic-key-by',
  language: 'typescript',
  title: {
    en: 'Build a generic keyBy helper',
    es: 'Construye un helper keyBy genérico',
  },
  prompt: {
    en:
      'Implement `keyBy(items, getKey)` so it returns an object whose keys come from `getKey` and whose values are the original items. Keep the helper generic: callers should retain the item and key types.\n\n' +
      'Do not mutate the input array.',
    es:
      'Implementa `keyBy(items, getKey)` para que devuelva un objeto cuyas claves vengan de `getKey` y cuyos valores sean los elementos originales. Mantén el helper genérico: cada llamada debe conservar los tipos del elemento y de la clave.\n\n' +
      'No modifiques el arreglo de entrada.',
  },
  starterCode: [
    'type User = { id: string; name: string };',
    '',
    'function keyBy<T, K extends PropertyKey>(',
    '  items: readonly T[],',
    '  getKey: (item: T) => K',
    '): Record<K, T> {',
    '  // TODO: build and return the typed lookup.',
    '  return {} as Record<K, T>;',
    '}',
    '',
    'const users: User[] = [',
    '  { id: "ana", name: "Ana" },',
    '  { id: "lin", name: "Lin" },',
    '  { id: "sam", name: "Sam" },',
    '];',
    'const usersById = keyBy(users, (user) => user.id);',
    '',
    'console.log(usersById);',
  ].join('\n'),
  assertions: [
    {
      id: 'indexes-every-user',
      name: {
        en: 'Indexes every user by id',
        es: 'Indexa cada usuario por id',
      },
      kind: 'value',
      code:
        'Object.keys(usersById).sort().join(",") === "ana,lin,sam"',
      hint: {
        en: 'Assign each item to `result[getKey(item)]` inside a loop.',
        es: 'Asigna cada elemento a `result[getKey(item)]` dentro de un loop.',
      },
    },
    {
      id: 'keeps-original-values',
      name: {
        en: 'Keeps the original values',
        es: 'Conserva los valores originales',
      },
      kind: 'value',
      code:
        'usersById.ana === users[0] && usersById.lin.name === "Lin" && usersById.sam.name === "Sam"',
    },
    {
      id: 'does-not-mutate-input',
      name: {
        en: 'Does not mutate the input',
        es: 'No modifica la entrada',
      },
      kind: 'value',
      code:
        'users.map((user) => user.id).join(",") === "ana,lin,sam"',
    },
  ],
  tags: ['typescript', 'generics', 'objects'],
};
