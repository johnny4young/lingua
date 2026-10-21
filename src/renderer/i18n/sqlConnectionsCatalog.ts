/**
 * English copy for database connections ships with the SQL workspace chunk
 * instead of the boot catalog; it merges into the common namespace, so keys
 * read as usual. Spanish loads with the rest of the lazy Spanish catalog.
 */
import i18next from 'i18next';
import { COMMON_NAMESPACE } from '../../shared/i18n/languages';
import en from './locales/en/sqlConnections.json';

const register = () => i18next.addResourceBundle('en', COMMON_NAMESPACE, en, true, false);

if (i18next.isInitialized) register();
else i18next.on('initialized', register);
