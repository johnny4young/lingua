/* eslint-disable @typescript-eslint/no-explicit-any */
/** Acorn helpers the record-run and live-signal instrumenters share. */
export type AcornNode = any;

export const MAX_NESTING = 400;

export const HOISTED = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'EmptyStatement',
]);

export function isNode(value: unknown): value is AcornNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function isFunction(node: AcornNode): boolean {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
}

/** Loop protection's counter and guard statements, and directives, are not the user's steps. */
export function isInjected(stmt: AcornNode): boolean {
  if (stmt.type === 'VariableDeclaration') {
    return stmt.declarations.every((decl: AcornNode) => /^__lp\d+$/.test(decl.id?.name ?? ''));
  }
  if (stmt.type === 'IfStatement') {
    const left = stmt.test?.left;
    return left?.type === 'UpdateExpression' && /^__lp\d+$/.test(left.argument?.name ?? '');
  }
  return stmt.type === 'ExpressionStatement' && typeof stmt.directive === 'string';
}

export function statementList(node: AcornNode): AcornNode[] | null {
  if (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock') return node.body;
  if (node.type === 'SwitchCase') return node.consequent;
  return null;
}
