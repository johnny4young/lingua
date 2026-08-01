/**
 * Desktop runtime result contracts shared by main, preload, and renderer.
 *
 * Invocation options remain owned by their runner because they include
 * main-only callbacks. These result shapes are structured-cloned over IPC and
 * therefore belong in a dependency-free shared module.
 */

export interface GoDetectResult {
  installed: boolean;
  version?: string;
  goRoot?: string;
  error?: string;
}

export interface GoCompileResult {
  success: boolean;
  wasmBytes?: Uint8Array;
  wasmExecJs?: string;
  error?: string;
  goVersion?: string;
}

export interface RustDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface RustRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
}

type NativeRunKind = 'success' | 'error' | 'timeout' | 'stopped' | 'missing-binary';

export type NodeRunKind = NativeRunKind;

export interface NodeDetectResult {
  installed: boolean;
  /** Binary selected for future runs; absolute for GUI fallback probes. */
  binary?: string;
  version?: string;
  error?: string;
}

export interface NodeRunResult {
  kind: NodeRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
}

export type RubyRunKind = NativeRunKind;

export interface RubyDetectResult {
  installed: boolean;
  version?: string;
  semver?: string;
  platform?: string;
  error?: string;
}

export interface RubyRunResult {
  kind: RubyRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
}

export type AltJsRunKind = NativeRunKind;

export interface AltJsDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface AltJsRunResult {
  kind: AltJsRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
}
