export const FAKE_GITHUB_PAT = ['ghp', 'A'.repeat(36)].join('_');

export const FAKE_GITHUB_PAT_SOURCE = `const token = "${FAKE_GITHUB_PAT}";`;

export const FAKE_JWT = ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(12)].join('.');
