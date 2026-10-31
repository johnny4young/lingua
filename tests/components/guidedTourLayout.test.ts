import { describe, expect, it } from 'vitest';
import { calculateArrow, calculatePanelStyle } from '@/components/GuidedTour/guidedTourLayout';

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
  it('parks the editor card in the empty lower corner of the code area', () => {
    const code = { top: 82, bottom: 560, left: 0, right: 1440, width: 1440, height: 478 };
    const style = calculatePanelStyle(code, 'inside-end', { width: 380, height: 200 }, { width: 1440, height: 900 });
    expect(style).toMatchObject({ left: 1440 - 380 - 16, top: 560 - 200 - 16 });
  });
});

describe('guided tour arrow', () => {
  const card = { left: 600, top: 90, width: 380, height: 180 };

  it('points up from a card below the control, at the control centre', () => {
    const run = { top: 8, bottom: 40, left: 760, right: 860, width: 100, height: 32 };
    expect(calculateArrow(run, card)).toEqual({ side: 'top', left: 810 - 6, top: 90 - 6 });
  });

  it('points down from a card above the console', () => {
    const console = { top: 400, bottom: 700, left: 0, right: 1440, width: 1440, height: 300 };
    expect(calculateArrow(console, card)).toMatchObject({ side: 'bottom', top: 270 - 6 });
  });

  it('keeps the arrow off the rounded corners when the target sits past the card', () => {
    const farLeft = { top: 8, bottom: 40, left: 0, right: 40, width: 40, height: 32 };
    expect(calculateArrow(farLeft, card)?.left).toBe(600 + 18 - 6);
  });

  it('draws no arrow when the card sits on top of its target', () => {
    const code = { top: 82, bottom: 560, left: 0, right: 1440, width: 1440, height: 478 };
    expect(calculateArrow(code, card)).toBeNull();
  });
});
