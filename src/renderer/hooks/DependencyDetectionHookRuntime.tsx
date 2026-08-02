import { useDependencyDetection } from './useDependencyDetection';

/** Null-rendering owner for the keystroke-reactive detection hook. */
export default function DependencyDetectionRuntime() {
  useDependencyDetection();
  return null;
}
