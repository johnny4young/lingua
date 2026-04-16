export function desktopSmokeEnabled(): boolean {
  return Boolean(window.lingua?.desktopSmoke?.enabled);
}

export function desktopSmokeApi() {
  return window.lingua?.desktopSmoke ?? null;
}
