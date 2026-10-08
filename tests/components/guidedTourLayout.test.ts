import { describe, expect, it } from 'vitest';
import { calculatePanelStyle } from '@/components/GuidedTour/guidedTourLayout';

const target = { top: 460, bottom: 740, left: 250, right: 1180, width: 930, height: 280 };
describe('guided tour card placement', () => {
  it.each([260, 330, 400])('keeps a measured %i px console card above the result', height => {
    const style = calculatePanelStyle(
      target,
      'top',
      { width: 400, height },
      { width: 1180, height: 757 }
    );
    expect(Number(style.top) + height).toBeLessThanOrEqual(target.top - 16);
  });
  it('uses the measured card width at a narrow viewport', () => {
    const style = calculatePanelStyle(
      target,
      'top',
      { width: 328, height: 330 },
      { width: 360, height: 757 }
    );
    expect(style.left).toBe(16);
  });
  it('bounds a tall translated card above the console with scrolling', () => {
    const style = calculatePanelStyle(
      target,
      'top',
      { width: 400, height: 600 },
      { width: 1180, height: 757 }
    );
    expect(style.maxHeight).toBe(428);
    expect(Number(style.top) + Number(style.maxHeight)).toBe(target.top - 16);
  });
});
