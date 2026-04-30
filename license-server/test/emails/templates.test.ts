/**
 * Snapshot tests for the 6 email HTML templates (RL-061 Slice 4).
 *
 * Each template gets rendered against a fixture set of variables,
 * and the output is snapshotted to `__snapshots__/`. A copy or
 * structure drift on any template fails the snapshot loud — the
 * maintainer reviewing a PR sees the exact diff and either
 * approves it (running `npx vitest -u` to update) or pushes back.
 *
 * No DOM-style HTML parsing — we treat the output as a pinned
 * string. The brittleness is intentional: emails are
 * deliverability-critical and any unexpected content change
 * deserves visibility.
 */

import { describe, expect, it } from 'vitest';
import layoutCss from '../../src/emails/_layout.css';
import trialTemplate from '../../src/emails/trial.html';
import educationConfirmationTemplate from '../../src/emails/educationConfirmation.html';
import educationTokenTemplate from '../../src/emails/educationToken.html';
import educationRenewalTemplate from '../../src/emails/educationRenewal.html';
import recoveryConfirmationTemplate from '../../src/emails/recoveryConfirmation.html';
import recoveryTokenTemplate from '../../src/emails/recoveryToken.html';
import { renderTemplate } from '../../src/lib/renderTemplate';

const FIXTURE_TOKEN = 'eyJsaWNlbnNlSWQiOiJsaWNfMSJ9.AAAAAAAAAAAAAAAAAAAAAA';
const FIXTURE_ISSUED_TO = 'student@stanford.edu';
const FIXTURE_DEEP_LINK = 'lingua://license?token=eyJsaWNlbnNlSWQiOiJsaWNfMSJ9.AAAAAAAAAAAAAAAAAAAAAA';
const FIXTURE_CONFIRM_LINK = 'https://licenses.linguacode.dev/education/confirm?confirm=11111111-2222-3333-4444-555555555555';
const FIXTURE_EXPIRES_ON = 'May 13, 2026';
const FIXTURE_TIER_LABEL = 'Lingua Pro Lifetime';

describe('email templates render against fixture vars', () => {
  it('trial.html', () => {
    const html = renderTemplate(trialTemplate, {
      layoutCss,
      issuedTo: FIXTURE_ISSUED_TO,
      token: FIXTURE_TOKEN,
      expiresOn: FIXTURE_EXPIRES_ON,
      deepLink: FIXTURE_DEEP_LINK,
    });
    expect(html).toMatchSnapshot();
  });

  it('educationConfirmation.html', () => {
    const html = renderTemplate(educationConfirmationTemplate, {
      layoutCss,
      issuedTo: FIXTURE_ISSUED_TO,
      confirmLink: FIXTURE_CONFIRM_LINK,
    });
    expect(html).toMatchSnapshot();
  });

  it('educationToken.html', () => {
    const html = renderTemplate(educationTokenTemplate, {
      layoutCss,
      issuedTo: FIXTURE_ISSUED_TO,
      token: FIXTURE_TOKEN,
      expiresOn: FIXTURE_EXPIRES_ON,
      deepLink: FIXTURE_DEEP_LINK,
    });
    expect(html).toMatchSnapshot();
  });

  it('educationRenewal.html', () => {
    const html = renderTemplate(educationRenewalTemplate, {
      layoutCss,
      issuedTo: FIXTURE_ISSUED_TO,
      token: FIXTURE_TOKEN,
      expiresOn: FIXTURE_EXPIRES_ON,
    });
    expect(html).toMatchSnapshot();
  });

  it('recoveryConfirmation.html', () => {
    const html = renderTemplate(recoveryConfirmationTemplate, {
      layoutCss,
      confirmLink: FIXTURE_CONFIRM_LINK,
    });
    expect(html).toMatchSnapshot();
  });

  it('recoveryToken.html', () => {
    const html = renderTemplate(recoveryTokenTemplate, {
      layoutCss,
      issuedTo: FIXTURE_ISSUED_TO,
      token: FIXTURE_TOKEN,
      tier: FIXTURE_TIER_LABEL,
      expiresOn: FIXTURE_EXPIRES_ON,
      deepLink: FIXTURE_DEEP_LINK,
    });
    expect(html).toMatchSnapshot();
  });
});

describe('email templates fail loud on missing vars', () => {
  it('trial.html requires deepLink (regression guard)', () => {
    expect(() =>
      renderTemplate(trialTemplate, {
        layoutCss,
        issuedTo: FIXTURE_ISSUED_TO,
        token: FIXTURE_TOKEN,
        expiresOn: FIXTURE_EXPIRES_ON,
        // deepLink intentionally missing
      })
    ).toThrowError(/missing variable "deepLink"/);
  });

  it('recoveryToken.html requires tier (regression guard)', () => {
    expect(() =>
      renderTemplate(recoveryTokenTemplate, {
        layoutCss,
        issuedTo: FIXTURE_ISSUED_TO,
        token: FIXTURE_TOKEN,
        expiresOn: FIXTURE_EXPIRES_ON,
        deepLink: FIXTURE_DEEP_LINK,
        // tier intentionally missing
      })
    ).toThrowError(/missing variable "tier"/);
  });
});
