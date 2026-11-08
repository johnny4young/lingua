/**
 * Local engine Settings and error copy follows the lazy SQL/Settings consumers,
 * rather than the English boot catalog. Spanish loads with its lazy catalog.
 */
import i18next from 'i18next';
import en from './locales/en/sqlLocal.json';

const register = () => i18next.addResourceBundle('en', 'common', en, true, false);

if (i18next.isInitialized) register();
else i18next.on('initialized', register);
