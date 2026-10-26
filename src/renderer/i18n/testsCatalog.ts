/**
 * English copy for the Tests dock tab ships with its chunk instead of the boot
 * catalog; it merges into the common namespace, so keys read as usual.
 */
import i18next from 'i18next';
import en from './locales/en/tests.json';

// The namespace is written out: importing the shared constant splits the languages module into its own boot chunk.
const register = () => i18next.addResourceBundle('en', 'common', en, true, false);

if (i18next.isInitialized) register();
else i18next.on('initialized', register);
