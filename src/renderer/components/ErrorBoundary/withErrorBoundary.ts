import { createElement, type ReactNode } from 'react';
import { ErrorBoundary, type ErrorBoundaryScope } from './ErrorBoundary';

/**
 * Convenience wrapper for "wrap one component in a panel-scoped
 * boundary". Use as `withErrorBoundary(<MyComponent />, 'Console')`.
 */
export function withErrorBoundary(
  children: ReactNode,
  regionName?: string,
  scope: ErrorBoundaryScope = 'panel'
): ReactNode {
  return createElement(ErrorBoundary, { scope, regionName, children });
}
