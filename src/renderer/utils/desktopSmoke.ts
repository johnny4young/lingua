export function desktopSmokeEnabled(): boolean {
  return Boolean(window.lingua?.desktopSmoke);
}

export function desktopSmokeApi() {
  return window.lingua?.desktopSmoke ?? null;
}
