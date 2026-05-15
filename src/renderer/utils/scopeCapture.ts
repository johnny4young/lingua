import { parse } from 'acorn';

interface AcornNode {
  type: string;
  [key: string]: unknown;
}

function asNode(value: unknown): AcornNode | null {
  return value && typeof value === 'object' && typeof (value as AcornNode).type === 'string'
    ? (value as AcornNode)
    : null;
}

function collectPatternNames(pattern: unknown, names: Set<string>): void {
  const node = asNode(pattern);
  if (!node) return;

  switch (node.type) {
    case 'Identifier': {
      if (typeof node.name === 'string') names.add(node.name);
      return;
    }
    case 'ObjectPattern': {
      const properties = Array.isArray(node.properties) ? node.properties : [];
      for (const property of properties) {
        const prop = asNode(property);
        if (!prop) continue;
        if (prop.type === 'RestElement') {
          collectPatternNames(prop.argument, names);
          continue;
        }
        collectPatternNames(prop.value, names);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = Array.isArray(node.elements) ? node.elements : [];
      for (const element of elements) collectPatternNames(element, names);
      return;
    }
    case 'AssignmentPattern': {
      collectPatternNames(node.left, names);
      return;
    }
    case 'RestElement': {
      collectPatternNames(node.argument, names);
      return;
    }
    default:
      return;
  }
}

/**
 * Collect top-level bindings that still exist when the scratchpad body
 * reaches its final statement. The JS worker runs user code inside an
 * AsyncFunction, so lexical bindings are function locals rather than
 * globalThis properties; the variable inspector has to capture them
 * before that function returns.
 */
export function collectTopLevelScopeNames(code: string): string[] {
  let ast: { body?: unknown };
  try {
    ast = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as { body?: unknown };
  } catch {
    return [];
  }

  const body = Array.isArray(ast.body) ? ast.body : [];
  const names = new Set<string>();

  for (const statement of body) {
    const node = asNode(statement);
    if (!node) continue;

    if (node.type === 'VariableDeclaration') {
      const declarations = Array.isArray(node.declarations)
        ? node.declarations
        : [];
      for (const declaration of declarations) {
        const decl = asNode(declaration);
        if (!decl) continue;
        collectPatternNames(decl.id, names);
      }
      continue;
    }

    if (
      (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
      asNode(node.id)?.type === 'Identifier'
    ) {
      const id = asNode(node.id);
      if (typeof id?.name === 'string') names.add(id.name);
    }
  }

  return [...names].sort();
}

export function appendScopeCapture(
  code: string,
  names: readonly string[]
): string {
  if (names.length === 0) return code;

  const getters = names
    .map((name) => `${JSON.stringify(name)}: () => ${name}`)
    .join(',\n');

  return `${code}\n;await __lingua_capture_scope({\n${getters}\n});`;
}
