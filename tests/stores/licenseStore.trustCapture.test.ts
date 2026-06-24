import { beforeEach, describe, expect, it } from 'vitest';

/**
 * RL-096 Slice 2 fold C — the licenseStore module-scope subscribe records a
 * `license` trust event whenever the status resolves into a verified kind
 * (active / grace), de-duped on the kind so a re-set does not double-record.
 *
 * The stores are imported INSIDE the test (not at top-level) so the
 * trustEventStore's persist storage resolves against jsdom's `localStorage`
 * once it is fully attached — a top-level import races store init ahead of
 * the DOM env and leaves persist with an undefined storage backend.
 *
 * The subscribe only reads `status.kind`, so driving `setState` transitions
 * is the faithful way to exercise it; we land on a non-verified kind first
 * to reset the module-scope de-dupe guard and keep the test order-stable.
 */
describe('licenseStore — trust capture (RL-096 Slice 2 fold C)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records a license trust event when status resolves to a verified kind', async () => {
    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const { useTrustEventStore } = await import('../../src/renderer/stores/trustEventStore');
    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'malformed' } } as never);
    useTrustEventStore.getState().clear();

    const licenseEvents = () =>
      useTrustEventStore.getState().events.filter((e) => e.feature === 'license');

    useLicenseStore.setState({ status: { kind: 'active' } } as never);
    expect(licenseEvents()).toHaveLength(1);
    expect(licenseEvents()[0]).toMatchObject({
      feature: 'license',
      action: 'verified',
      sensitivity: 'low',
    });

    // Re-setting the same verified kind must NOT double-record (de-dupe).
    useLicenseStore.setState({ status: { kind: 'active' } } as never);
    expect(licenseEvents()).toHaveLength(1);

    // Dropping out of verified then into grace records again.
    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'malformed' } } as never);
    useLicenseStore.setState({ status: { kind: 'grace' } } as never);
    expect(licenseEvents()).toHaveLength(2);
  });

  it('does NOT record while status stays unverified (free / invalid)', async () => {
    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const { useTrustEventStore } = await import('../../src/renderer/stores/trustEventStore');
    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'malformed' } } as never);
    useTrustEventStore.getState().clear();
    useLicenseStore.setState({ status: { kind: 'free' } } as never);
    expect(
      useTrustEventStore.getState().events.filter((e) => e.feature === 'license')
    ).toHaveLength(0);
  });
});
