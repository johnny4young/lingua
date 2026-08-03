/**
 * Startup-safe share-link protocol vocabulary.
 *
 * Keep the fragment discriminator separate from the gzip/JSON codec so the
 * renderer can detect whether an incoming URL belongs to Lingua without
 * downloading the complete sharing implementation on every workspace boot.
 */
export const SHARE_FRAGMENT_PREFIX = 'share=v1.';
