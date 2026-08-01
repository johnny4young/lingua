// SPDX-License-Identifier: MIT
/** Syntax-aware Node input-mode detection shared by desktop and headless runners. */

import { parse } from 'acorn';
import type { Node as AcornNode, Program as AcornProgram } from 'acorn';

function isAcornNode(value: unknown): value is AcornNode {
  return (
    typeof value === 'object' && value !== null && typeof (value as AcornNode).type === 'string'
  );
}

function isFunctionScope(node: AcornNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function nodeContainsModuleOnlyExpression(node: AcornNode): boolean {
  if (node.type === 'AwaitExpression') return true;
  if (node.type === 'MetaProperty') {
    const meta = (node as AcornNode & { meta?: { name?: unknown } }).meta;
    const property = (node as AcornNode & { property?: { name?: unknown } }).property;
    if (meta?.name === 'import' && property?.name === 'meta') return true;
  }
  if (isFunctionScope(node)) return false;

  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (value.some(entry => isAcornNode(entry) && nodeContainsModuleOnlyExpression(entry))) {
        return true;
      }
    } else if (isAcornNode(value) && nodeContainsModuleOnlyExpression(value)) {
      return true;
    }
  }
  return false;
}

export function sourceRequiresModuleInput(source: string): boolean {
  try {
    const program = parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as AcornProgram;
    return program.body.some(statement => {
      if (
        statement.type === 'ImportDeclaration' ||
        statement.type === 'ExportAllDeclaration' ||
        statement.type === 'ExportDefaultDeclaration' ||
        statement.type === 'ExportNamedDeclaration'
      ) {
        return true;
      }
      return nodeContainsModuleOnlyExpression(statement);
    });
  } catch {
    // Incomplete input and TypeScript-only syntax should be reported by the
    // selected runtime, not reclassified by a speculative parser fallback.
    return false;
  }
}

export function sourceLooksCommonJs(source: string): boolean {
  return /\b(?:require\s*\(|module\.exports\b|exports\.\w+\b|__dirname\b|__filename\b)/u.test(
    source
  );
}
