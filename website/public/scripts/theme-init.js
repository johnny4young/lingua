try {
  const stored = localStorage.getItem('lingua-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
} catch {}
