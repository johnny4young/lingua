/**
 * String Inspector — re-export shim.
 *
 * The implementation moved into the shared utility layer under internal
 * implementation (implementation note) so the pipeline `string-inspect` adapter and this
 * renderer surface share one set of detection tables. Renderer code keeps
 * importing from `../utils/stringInspector` unchanged.
 */

export * from '../../shared/utilities/stringInspect';
