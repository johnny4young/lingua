import { expect, test } from '@playwright/test';

// axe-core cannot reliably resolve this app's OKLCH design tokens. Measure the
// emitted colors in Chromium instead of disabling contrast without a gate.
test('emitted shell text tokens meet AA contrast in both themes', async ({ page }) => {
  await page.goto('/');

  const results = await page.evaluate(() => {
    const root = document.documentElement;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for contrast measurement');

    const luminance = (color: string): number => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => channel / 255)
        .map((channel) => channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };

    const pairs = [
      ['fg-subtle', 'bg-base'],
      ['fg-subtle', 'bg-panel'],
      ['fg-subtle', 'bg-panel-alt'],
      ['fg-subtle', 'bg-inset'],
      ['console-timestamp', 'console-bg'],
    ] as const;

    return (['light', 'dark'] as const).flatMap((theme) => {
      root.classList.toggle('dark', theme === 'dark');
      root.setAttribute('data-theme', theme);
      const style = getComputedStyle(root);
      return pairs.map(([foreground, background]) => {
        const foregroundColor = style.getPropertyValue(`--color-${foreground}`).trim();
        const backgroundColor = style.getPropertyValue(`--color-${background}`).trim();
        if (!foregroundColor || !backgroundColor) {
          throw new Error(`Missing color token: ${foreground}/${background}`);
        }
        const values = [luminance(foregroundColor), luminance(backgroundColor)]
          .sort((a, b) => b - a);
        return {
          theme,
          foreground,
          background,
          ratio: (values[0]! + 0.05) / (values[1]! + 0.05),
        };
      });
    });
  });

  for (const { theme, foreground, background, ratio } of results) {
    expect(ratio, `${theme}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(4.5);
  }
});
