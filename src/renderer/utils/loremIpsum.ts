/**
 * Lorem Ipsum generator — re-export shim.
 *
 * The implementation moved into the shared utility layer under RL-099
 * Slice 7 (fold A) so the pipeline `lorem-ipsum` adapter and this renderer
 * surface share one corpus + assembler. Renderer code keeps importing from
 * `../utils/loremIpsum` unchanged.
 */

export * from '../../shared/utilities/loremIpsum';
