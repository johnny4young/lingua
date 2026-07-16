/**
 * Deliberately non-secret JWT-shaped fixture used by smart-paste tests.
 * Joining the three harmless segments at runtime prevents secret scanners
 * from treating a checked-in dotted token as a credential.
 */
export const NON_SECRET_TEST_JWT = [
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0',
  'eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZml4dHVyZSJ9',
  'bm90LWEtcmVhbC1zaWduYXR1cmU',
].join('.');
