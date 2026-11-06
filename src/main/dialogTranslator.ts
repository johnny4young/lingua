type Translate = (
  language: string | undefined,
  key: string,
  options?: Record<string, unknown>
) => string;

/** Loads the i18n catalogs with the first native dialog instead of with main itself. */
export async function loadDialogTranslator(): Promise<Translate> {
  const { translateCommon } = await import('../shared/i18n/runtime');
  return (language, key, options) => translateCommon(language ?? 'en', key, options);
}
