// Generated text a value could turn into something else: `//=>` and `// @timeout` are read as
// directives even inside a string, and bidi controls can disguise what a line says.
const asSource = (text: string) =>
  text
    .replace(/\/\/(?=\s*(?:=>|@))/g, '/\\/')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** A JavaScript string literal for generated source. */
export const quoted = (text: string) => asSource(JSON.stringify(text));
