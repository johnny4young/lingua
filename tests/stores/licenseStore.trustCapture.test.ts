import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The licenseStore module-scope subscribe records a
 * `license` trust event whenever the status resolves into a verified kind
 * (active / grace) or a rejection (invalid, keyed by reason), de-duped so a
 * re-set does not double-record.
 *
 * The stores are imported INSIDE the test (not at top-level) so the
 * trustEventStore's persist storage resolves against jsdom's `localStorage`
 * once it is fully attached — a top-level import races store init ahead of
 * the DOM env and leaves persist with an undefined storage backend.
 *
 * The subscribe only reads `status`, so driving `setState` transitions
 * is the faithful way to exercise it; we land on `free` first to reset the
 * module-scope de-dupe guard and keep the test order-stable.
 */
describe('licenseStore — trust capture', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function setup() {
    const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');
    const { useTrustEventStore } = await import('../../src/renderer/stores/trustEventStore');
    useLicenseStore.setState({ status: { kind: 'free' } } as never);
    useTrustEventStore.getState().clear();
    const licenseEvents = () =>
      useTrustEventStore.getState().events.filter((e) => e.feature === 'license');
    return { useLicenseStore, licenseEvents };
  }

  it('records a license trust event when status resolves to a verified kind', async () => {
    const { useLicenseStore, licenseEvents } = await setup();

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
    useLicenseStore.setState({ status: { kind: 'free' } } as never);
    useLicenseStore.setState({ status: { kind: 'grace' } } as never);
    expect(licenseEvents()).toHaveLength(2);
  });

  it('records a rejection with its reason code, once per reason', async () => {
    const { useLicenseStore, licenseEvents } = await setup();

    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'invalid-signature' } } as never);
    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'invalid-signature' } } as never);
    expect(licenseEvents()).toHaveLength(1);
    expect(licenseEvents()[0]).toMatchObject({
      action: 'rejected',
      sensitivity: 'low',
      summary: 'License rejected (invalid-signature)',
    });

    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'unknown-license' } } as never);
    expect(licenseEvents()).toHaveLength(2);
  });

  it('never copies a non-code reason into the log', async () => {
    const { useLicenseStore, licenseEvents } = await setup();
    useLicenseStore.setState({ status: { kind: 'invalid', reason: 'eyJ0b2tlbiI6Ii4uLiJ9.sig' } } as never);
    expect(licenseEvents()).toHaveLength(1);
    expect(licenseEvents()[0]?.summary).toBe('License rejected (unknown)');
  });

  it('does NOT record while status stays free or verifying', async () => {
    const { useLicenseStore, licenseEvents } = await setup();
    useLicenseStore.setState({ status: { kind: 'verifying' } } as never);
    useLicenseStore.setState({ status: { kind: 'free' } } as never);
    expect(licenseEvents()).toHaveLength(0);
  });
});
