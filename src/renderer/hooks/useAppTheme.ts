import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { applyAppTheme } from '../utils/appTheme';

export function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    applyAppTheme(theme);
  }, [theme]);
}
