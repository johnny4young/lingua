/** font-variation-settings for an editor stack: Recursive needs its MONO axis to be a code face. */
export function editorFontVariations(fontFamily: string): string | false {
  return /^\s*['"]?Recursive\b/.test(fontFamily) ? "'MONO' 1" : false;
}
