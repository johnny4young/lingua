/**
 * English copy for run regions ships with its chunk instead of the boot
 * catalog; Spanish loads with the rest of the lazy Spanish catalog.
 */
import i18next from 'i18next';
import en from './locales/en/runRegions.json';

// The namespace is written out: importing the shared constant splits the languages module into its own boot chunk.
const register = () => i18next.addResourceBundle('en', 'common', en, true, false);

if (i18next.isInitialized) register();
else i18next.on('initialized', register);
