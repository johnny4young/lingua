/**
 * Origin of the built desktop renderer; dev servers keep their loopback origin.
 * Local model servers such as Ollama accept app://* by default.
 */
export const DESKTOP_RENDERER_SCHEME = 'app';
export const DESKTOP_RENDERER_HOST = 'lingua';
export const DESKTOP_RENDERER_ORIGIN = `${DESKTOP_RENDERER_SCHEME}://${DESKTOP_RENDERER_HOST}`;
