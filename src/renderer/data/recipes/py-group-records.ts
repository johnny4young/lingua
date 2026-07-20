/** implementation — Recipe `py-group-records`. */

import type { LessonPackV1 } from '../../../shared/lessonPack';

export const recipe: LessonPackV1 = {
  version: 1,
  id: 'py-group-records',
  language: 'python',
  title: {
    en: 'Group records by department',
    es: 'Agrupa registros por departamento',
  },
  prompt: {
    en:
      'Implement `group_by_department(records)` so it returns a dictionary from each department to the matching employee records. Preserve the input order inside every group and do not mutate the list.\n\n' +
      'An empty input should return an empty dictionary.',
    es:
      'Implementa `group_by_department(records)` para que devuelva un diccionario que relacione cada departamento con sus empleados. Conserva el orden de entrada dentro de cada grupo y no modifiques la lista.\n\n' +
      'Una entrada vacía debe devolver un diccionario vacío.',
  },
  starterCode: [
    'def group_by_department(records: list[dict]) -> dict[str, list[dict]]:',
    '    # TODO: collect each record under its department.',
    '    return {}',
    '',
    'employees = [',
    '    {"name": "Ana", "department": "engineering"},',
    '    {"name": "Luis", "department": "design"},',
    '    {"name": "Marta", "department": "engineering"},',
    ']',
    'grouped = group_by_department(employees)',
    'print(grouped)',
  ].join('\n'),
  assertions: [
    {
      id: 'creates-department-keys',
      name: {
        en: 'Creates both department keys',
        es: 'Crea las dos claves de departamento',
      },
      kind: 'value',
      code: 'set(grouped.keys()) == {"engineering", "design"}',
      hint: {
        en: 'Use `setdefault(department, [])` before appending.',
        es: 'Usa `setdefault(department, [])` antes de agregar.',
      },
    },
    {
      id: 'preserves-order',
      name: {
        en: 'Preserves order inside a group',
        es: 'Conserva el orden dentro de un grupo',
      },
      kind: 'value',
      code:
        '[person["name"] for person in grouped["engineering"]] == ["Ana", "Marta"]',
    },
    {
      id: 'handles-empty-records',
      name: { en: 'Handles an empty list', es: 'Maneja una lista vacía' },
      kind: 'value',
      code: 'group_by_department([]) == {}',
    },
  ],
  tags: ['python', 'dictionaries', 'lists'],
};
