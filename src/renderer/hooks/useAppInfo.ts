import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/appInfo';

export function useAppInfo() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.lingua
      .getAppInfo()
      .then((nextInfo) => {
        if (!cancelled) {
          setAppInfo(nextInfo);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppInfo(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return appInfo;
}
