import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n, resolveSystemLanguage } from './i18n';
import { useSettingsStore } from './stores/settingsStore';
import './index.css';

async function bootstrap() {
  const { language } = useSettingsStore.getState();

  let resolved = language as string;
  if (language === 'system') {
    try {
      const systemLangs = await window.lingua.getSystemLanguages();
      resolved = resolveSystemLanguage(systemLangs);
    } catch {
      resolved = 'en';
    }
  }

  initI18n(resolved);

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
