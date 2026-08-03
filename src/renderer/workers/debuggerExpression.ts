/**
 * Bounded, side-effect-resistant expression support for the JS/TS debugger.
 *
 * This is deliberately NOT JavaScript eval. Acorn parses one expression and a
 * small interpreter executes only data-oriented syntax over a detached locals
 * snapshot. Calls, constructors, assignments, updates, prototype traversal,
 * inherited properties, await/yield, and dynamic code are rejected.
 */

import { parseExpressionAt, type Node } from 'acorn';

export const MAX_DEBUGGER_EXPRESSION_LENGTH = 512;
export const MAX_DEBUGGER_LOGPOINT_LENGTH = 1_024;
const MAX_LOGPOINT_OUTPUT_LENGTH = 4_096;
const MAX_EXPRESSION_STEPS = 512;
const MAX_AST_DEPTH = 32;
const MAX_SNAPSHOT_DEPTH = 4;
const MAX_SNAPSHOT_ENTRIES = 100;
const MAX_SNAPSHOT_NODES = 512;
const MAX_SNAPSHOT_STRING_LENGTH = 2_048;
const MAX_LOGPOINT_EXPRESSIONS = 16;

const FORBIDDEN_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor']);

type ExpressionRecord = Node & Record<string, unknown>;
export type DebuggerScopeSnapshot = Record<string, unknown>;

export type DebuggerEvaluationResult = { ok: true; value: unknown } | { ok: false; error: string };

export type DebuggerLogpointResult = { ok: true; output: string } | { ok: false; error: string };

interface SnapshotContext {
  seen: WeakSet<object>;
  nodes: number;
}

function clippedString(value: string): string {
  return value.length <= MAX_SNAPSHOT_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)}…`;
}

function snapshotValue(value: unknown, depth: number, context: SnapshotContext): unknown {
  if (typeof value === 'string') return clippedString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') {
    return value.name ? `[Function ${value.name}]` : '[Function]';
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_SNAPSHOT_DEPTH) return '[Depth limit]';
  if (context.nodes >= MAX_SNAPSHOT_NODES) return '[Snapshot limit]';
  if (context.seen.has(value)) return '[Circular]';

  context.seen.add(value);
  context.nodes += 1;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      const length = Math.min(value.length, MAX_SNAPSHOT_ENTRIES);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        out.push(
          descriptor && 'value' in descriptor
            ? snapshotValue(descriptor.value, depth + 1, context)
            : undefined
        );
      }
      if (value.length > length) out.push('[Entry limit]');
      return out;
    }

    const out = Object.create(null) as Record<string, unknown>;
    let count = 0;
    for (const key of Object.keys(descriptors)) {
      if (FORBIDDEN_PROPERTIES.has(key)) continue;
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) continue;
      out[key] = snapshotValue(descriptor.value, depth + 1, context);
      count += 1;
      if (count >= MAX_SNAPSHOT_ENTRIES) {
        out['[Entry limit]'] = true;
        break;
      }
    }
    return out;
  } catch {
    return '[Unavailable object]';
  } finally {
    context.seen.delete(value);
  }
}

export function snapshotDebuggerScope(rawScope: Record<string, unknown>): DebuggerScopeSnapshot {
  const snapshot = Object.create(null) as DebuggerScopeSnapshot;
  const context: SnapshotContext = { seen: new WeakSet(), nodes: 0 };
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(rawScope);
  } catch {
    return snapshot;
  }

  let count = 0;
  for (const key of Object.keys(descriptors)) {
    if (FORBIDDEN_PROPERTIES.has(key)) continue;
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) continue;
    snapshot[key] = snapshotValue(descriptor.value, 0, context);
    count += 1;
    if (count >= MAX_SNAPSHOT_ENTRIES) break;
  }
  return snapshot;
}

function nodeRecord(value: unknown): ExpressionRecord {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    throw new Error('Invalid expression node');
  }
  return value as ExpressionRecord;
}

function ownDataProperty(value: unknown, rawKey: unknown): unknown {
  if (value === null || value === undefined) {
    throw new Error('Cannot inspect null or undefined');
  }
  const key = typeof rawKey === 'symbol' ? rawKey : String(rawKey);
  if (typeof key === 'string' && FORBIDDEN_PROPERTIES.has(key)) {
    throw new Error('Prototype access is not allowed');
  }
  if (typeof value === 'string') {
    if (key === 'length') return value.length;
    if (typeof key === 'string' && /^\d+$/u.test(key)) return value[Number(key)];
    return undefined;
  }
  if (typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) return undefined;
  return descriptor.value;
}

function primitiveNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (typeof value === 'string') return Number(value);
  throw new Error('A primitive number is required');
}

function primitiveString(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object' || typeof value === 'function') {
    throw new Error('A primitive value is required');
  }
  return String(value);
}

function comparePrimitives(
  left: unknown,
  right: unknown,
  operator: '<' | '<=' | '>' | '>='
): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    if (operator === '<') return left < right;
    if (operator === '<=') return left <= right;
    if (operator === '>') return left > right;
    return left >= right;
  }

  const leftNumber = primitiveNumber(left);
  const rightNumber = primitiveNumber(right);
  if (operator === '<') return leftNumber < rightNumber;
  if (operator === '<=') return leftNumber <= rightNumber;
  if (operator === '>') return leftNumber > rightNumber;
  return leftNumber >= rightNumber;
}

function evaluateNode(
  rawNode: unknown,
  scope: DebuggerScopeSnapshot,
  budget: { steps: number },
  depth: number
): unknown {
  budget.steps += 1;
  if (budget.steps > MAX_EXPRESSION_STEPS || depth > MAX_AST_DEPTH) {
    throw new Error('Expression budget exceeded');
  }
  const node = nodeRecord(rawNode);

  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier': {
      const name = String(node.name);
      if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
      if (name === 'undefined') return undefined;
      if (name === 'NaN') return Number.NaN;
      if (name === 'Infinity') return Number.POSITIVE_INFINITY;
      throw new Error(`Unknown identifier: ${name}`);
    }
    case 'ArrayExpression': {
      const elements = Array.isArray(node.elements) ? node.elements : [];
      return elements.map(element =>
        element === null ? undefined : evaluateNode(element, scope, budget, depth + 1)
      );
    }
    case 'ObjectExpression': {
      const output = Object.create(null) as Record<string, unknown>;
      const properties = Array.isArray(node.properties) ? node.properties : [];
      for (const rawProperty of properties) {
        const property = nodeRecord(rawProperty);
        if (property.type !== 'Property' || property.kind !== 'init' || property.method === true) {
          throw new Error('Object methods and spread are not allowed');
        }
        const keyNode = nodeRecord(property.key);
        const key =
          property.computed === true
            ? evaluateNode(keyNode, scope, budget, depth + 1)
            : keyNode.type === 'Identifier'
              ? String(keyNode.name)
              : String(keyNode.value);
        if (FORBIDDEN_PROPERTIES.has(String(key))) {
          throw new Error('Prototype access is not allowed');
        }
        output[String(key)] = evaluateNode(property.value, scope, budget, depth + 1);
      }
      return output;
    }
    case 'UnaryExpression': {
      const operator = String(node.operator);
      const argument = evaluateNode(node.argument, scope, budget, depth + 1);
      if (operator === '!') return !argument;
      if (operator === '+') return primitiveNumber(argument);
      if (operator === '-') return -primitiveNumber(argument);
      if (operator === '~') return ~primitiveNumber(argument);
      if (operator === 'typeof') return typeof argument;
      if (operator === 'void') return undefined;
      throw new Error(`Unsupported unary operator: ${operator}`);
    }
    case 'BinaryExpression': {
      const operator = String(node.operator);
      const left = evaluateNode(node.left, scope, budget, depth + 1);
      const right = evaluateNode(node.right, scope, budget, depth + 1);
      switch (operator) {
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? primitiveString(left) + primitiveString(right)
            : primitiveNumber(left) + primitiveNumber(right);
        case '-':
          return primitiveNumber(left) - primitiveNumber(right);
        case '*':
          return primitiveNumber(left) * primitiveNumber(right);
        case '/':
          return primitiveNumber(left) / primitiveNumber(right);
        case '%':
          return primitiveNumber(left) % primitiveNumber(right);
        case '**':
          return primitiveNumber(left) ** primitiveNumber(right);
        case '<':
          return comparePrimitives(left, right, '<');
        case '<=':
          return comparePrimitives(left, right, '<=');
        case '>':
          return comparePrimitives(left, right, '>');
        case '>=':
          return comparePrimitives(left, right, '>=');
        case '==':
        case '!=':
          throw new Error('Use strict equality (=== or !==)');
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '|':
          return primitiveNumber(left) | primitiveNumber(right);
        case '&':
          return primitiveNumber(left) & primitiveNumber(right);
        case '^':
          return primitiveNumber(left) ^ primitiveNumber(right);
        case '<<':
          return primitiveNumber(left) << primitiveNumber(right);
        case '>>':
          return primitiveNumber(left) >> primitiveNumber(right);
        case '>>>':
          return primitiveNumber(left) >>> primitiveNumber(right);
        default:
          throw new Error(`Unsupported binary operator: ${operator}`);
      }
    }
    case 'LogicalExpression': {
      const operator = String(node.operator);
      const left = evaluateNode(node.left, scope, budget, depth + 1);
      if (operator === '&&') {
        return left ? evaluateNode(node.right, scope, budget, depth + 1) : left;
      }
      if (operator === '||') {
        return left ? left : evaluateNode(node.right, scope, budget, depth + 1);
      }
      if (operator === '??') {
        return left ?? evaluateNode(node.right, scope, budget, depth + 1);
      }
      throw new Error(`Unsupported logical operator: ${operator}`);
    }
    case 'ConditionalExpression':
      return evaluateNode(node.test, scope, budget, depth + 1)
        ? evaluateNode(node.consequent, scope, budget, depth + 1)
        : evaluateNode(node.alternate, scope, budget, depth + 1);
    case 'MemberExpression': {
      const object = evaluateNode(node.object, scope, budget, depth + 1);
      if (node.optional === true && (object === null || object === undefined)) return undefined;
      const propertyNode = nodeRecord(node.property);
      const key =
        node.computed === true
          ? evaluateNode(propertyNode, scope, budget, depth + 1)
          : String(propertyNode.name);
      return ownDataProperty(object, key);
    }
    case 'ChainExpression':
      return evaluateNode(node.expression, scope, budget, depth + 1);
    case 'TemplateLiteral': {
      const quasis = Array.isArray(node.quasis) ? node.quasis : [];
      const expressions = Array.isArray(node.expressions) ? node.expressions : [];
      let output = '';
      for (let index = 0; index < quasis.length; index += 1) {
        const quasi = nodeRecord(quasis[index]);
        const quasiValue =
          quasi.value && typeof quasi.value === 'object'
            ? (quasi.value as Record<string, unknown>)
            : null;
        const value = quasiValue?.cooked;
        output += typeof value === 'string' ? value : '';
        const expression = expressions[index];
        if (expression) {
          output += primitiveString(evaluateNode(expression, scope, budget, depth + 1));
        }
      }
      return output;
    }
    default:
      throw new Error(`Unsupported syntax: ${node.type}`);
  }
}

function parseDebuggerExpression(expression: string): Node {
  const trimmed = expression.trim();
  if (!trimmed) throw new Error('Expression is empty');
  if (trimmed.length > MAX_DEBUGGER_EXPRESSION_LENGTH) {
    throw new Error('Expression is too long');
  }
  let node: Node;
  try {
    node = parseExpressionAt(trimmed, 0, { ecmaVersion: 'latest' });
  } catch {
    throw new Error('Invalid expression');
  }
  if (trimmed.slice(node.end).trim().length > 0) {
    throw new Error('Only one expression is allowed');
  }
  return node;
}

export function evaluateDebuggerExpression(
  expression: string,
  scope: DebuggerScopeSnapshot
): DebuggerEvaluationResult {
  try {
    const node = parseDebuggerExpression(expression);
    return { ok: true, value: evaluateNode(node, scope, { steps: 0 }, 0) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Evaluation failed' };
  }
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value, (_key, candidate) =>
      typeof candidate === 'bigint' ? `${candidate}n` : candidate
    );
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function renderDebuggerLogpoint(
  template: string,
  scope: DebuggerScopeSnapshot
): DebuggerLogpointResult {
  if (!template.trim()) return { ok: false, error: 'Logpoint message is empty' };
  if (template.length > MAX_DEBUGGER_LOGPOINT_LENGTH) {
    return { ok: false, error: 'Logpoint message is too long' };
  }

  try {
    let output = '';
    let index = 0;
    let expressions = 0;
    while (index < template.length) {
      const character = template[index];
      if (character === '{' && template[index + 1] === '{') {
        output += '{';
        index += 2;
        continue;
      }
      if (character === '}' && template[index + 1] === '}') {
        output += '}';
        index += 2;
        continue;
      }
      if (character === '}') throw new Error('Unmatched closing brace');
      if (character !== '{') {
        output += character;
        index += 1;
        continue;
      }

      expressions += 1;
      if (expressions > MAX_LOGPOINT_EXPRESSIONS) {
        throw new Error('Too many logpoint expressions');
      }
      const expressionStart = index + 1;
      let node: Node;
      try {
        node = parseExpressionAt(template, expressionStart, { ecmaVersion: 'latest' });
      } catch {
        throw new Error('Invalid logpoint expression');
      }
      let closeIndex = node.end;
      while (/\s/u.test(template[closeIndex] ?? '')) closeIndex += 1;
      if (template[closeIndex] !== '}') throw new Error('Unmatched opening brace');
      const expression = template.slice(expressionStart, node.end);
      const result = evaluateDebuggerExpression(expression, scope);
      if (!result.ok) throw new Error(result.error);
      output += displayValue(result.value);
      index = closeIndex + 1;
      if (output.length > MAX_LOGPOINT_OUTPUT_LENGTH) {
        output = `${output.slice(0, MAX_LOGPOINT_OUTPUT_LENGTH)}…`;
        break;
      }
    }
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Logpoint failed' };
  }
}
