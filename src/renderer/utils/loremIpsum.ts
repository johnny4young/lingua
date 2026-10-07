/**
 * Lorem Ipsum generator — re-export shim.
 *
 * The implementation moved into the shared utility layer
 * so the pipeline `lorem-ipsum` adapter and this renderer
 * surface share one corpus + assembler. Renderer code keeps importing from
 * `../utils/loremIpsum` unchanged.
 */

export * from '../../shared/utilities/loremIpsum';
