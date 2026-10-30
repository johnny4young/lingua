import { describe, expect, it } from 'vitest';
import { advanceSlots, pushToSlots, type StatusNoticeSlots } from '../../src/renderer/stores/statusNoticeQueue';
import type { StatusNotice } from '../../src/renderer/stores/uiStore';

let id = 0;
const notice = (messageKey: string, extra: Partial<StatusNotice> = {}): StatusNotice => ({ id: (id += 1), tone: 'info', messageKey, ...extra });
const action = [{ labelKey: 'cta', onClick: () => undefined }];
const empty: StatusNoticeSlots = { visible: null, queue: [] };
const keys = (slots: StatusNoticeSlots) => [slots.visible?.messageKey ?? null, ...slots.queue.map(entry => entry.messageKey)];

function pushAll(...notices: StatusNotice[]) {
  let slots = empty;
  const dropped: string[] = [];
  for (const next of notices) {
    const change = pushToSlots(slots, next);
    slots = change.slots;
    dropped.push(...change.dropped.map(entry => entry.messageKey));
  }
  return { slots, dropped };
}

describe('status notice queue', () => {
  it('lets newer plain feedback replace older plain feedback', () => {
    const { slots, dropped } = pushAll(notice('running'), notice('done'));
    expect(keys(slots)).toEqual(['done']);
    expect(dropped).toEqual(['running']);
  });

  it('keeps a decision on screen and lines up what arrives behind it', () => {
    const { slots, dropped } = pushAll(
      notice('restore', { sticky: true, actions: action }),
      notice('copied'),
      notice('saved'),
      notice('upsell', { priority: 'high', actions: action })
    );
    expect(keys(slots)).toEqual(['restore', 'upsell', 'saved']);
    expect(dropped).toEqual(['copied']);
    expect(keys(advanceSlots(slots))).toEqual(['upsell', 'saved']);
  });

  it('answers the latest action first and brings an interrupted offer back', () => {
    const { slots } = pushAll(notice('snippet offer', { tone: 'success', actions: action }), notice('tab limit', { priority: 'high', actions: action }));
    expect(keys(slots)).toEqual(['tab limit', 'snippet offer']);
  });

  it('puts errors and warnings ahead of a decision, which comes back after', () => {
    const { slots } = pushAll(notice('restore', { sticky: true, actions: action }), notice('write failed', { tone: 'warning' }));
    expect(keys(slots)).toEqual(['write failed', 'restore']);
  });

  it('makes a lower-priority push wait and reports the notice that stayed', () => {
    const high = notice('first run', { priority: 'high' });
    const change = pushToSlots({ visible: high, queue: [] }, notice('format unavailable'));
    expect(keys(change.slots)).toEqual(['first run', 'format unavailable']);
    expect(change.survived).toBe(high);
  });

  it('refreshes a repeat in place instead of showing it twice', () => {
    const { slots, dropped } = pushAll(
      notice('restore', { sticky: true }),
      notice('limit', { priority: 'high', values: { feature: 'tabs' } }),
      notice('limit', { priority: 'high', values: { feature: 'tabs' } })
    );
    expect(keys(slots)).toEqual(['restore', 'limit']);
    expect(dropped).toEqual(['limit']);
  });

  it('caps the backlog by dropping the least important notice', () => {
    const { slots, dropped } = pushAll(
      notice('restore', { sticky: true }),
      notice('a', { priority: 'high', actions: action }),
      notice('b', { priority: 'high', actions: action }),
      notice('c', { actions: action }),
      notice('d', { actions: action }),
      notice('e', { actions: action }),
      notice('f', { priority: 'high', actions: action })
    );
    expect(keys(slots)).toEqual(['restore', 'a', 'b', 'f', 'c', 'd']);
    expect(dropped).toEqual(['e']);
  });
});
