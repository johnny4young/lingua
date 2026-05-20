/**
 * RL-044 Slice 2a — `image` payload renderer. Validates the source
 * against the shared `validateImageSrc` whitelist (`data:image/...` /
 * `blob:` / `https://` only). Rejected sources fall through to a
 * localized text fallback and fire the
 * `runtime.rich_media_payload_rejected` telemetry event so security
 * dashboards can isolate them.
 *
 * Renderer-side image cap: `max-height: 400px` + `object-fit:
 * contain`. The browser handles oversized data: URLs via the existing
 * `MAX_IMAGE_SRC_LENGTH` cap in `validateImageSrc`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputImage } from '../../../shared/richOutput';
import { validateImageSrc } from '../../../shared/richOutput';
import { trackEvent } from '../../utils/telemetry';

interface RichValueImageProps {
  payload: RichOutputImage;
  fallbackText?: string;
}

export function RichValueImage({ payload, fallbackText }: RichValueImageProps) {
  const { t } = useTranslation();
  const validated = useMemo(() => validateImageSrc(payload.src), [payload.src]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loadError = validated !== null && failedSrc === validated;

  useEffect(() => {
    if (validated === null) {
      void trackEvent('runtime.rich_media_payload_rejected', {
        kind: 'image',
        reason:
          typeof payload.src === 'string' && payload.src.length > 0
            ? 'invalid-src'
            : 'validation-failed',
      });
    }
  }, [validated, payload.src]);

  if (validated === null) {
    return (
      <span
        className="rounded-md bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-fg-subtle"
        data-testid="console-rich-image-rejected"
        title={fallbackText}
      >
        {t('console.rich.imageInvalidSrc')}
      </span>
    );
  }

  if (loadError) {
    return (
      <span
        className="rounded-md bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-fg-subtle"
        data-testid="console-rich-image-load-failed"
      >
        {t('console.rich.imageInvalidSrc')}
      </span>
    );
  }

  // Localized alt text: the image is a runtime console payload — its
  // semantic meaning to a screen-reader is "image emitted by the
  // running program," with the MIME type as an additional hint.
  const altText = t('console.rich.imagePlaceholder', {
    mime: payload.mime ?? 'image',
  });

  return (
    <span className="inline-block align-middle" data-testid="console-rich-image-wrapper">
      <img
        src={validated}
        alt={altText}
        data-testid="console-rich-image"
        onError={() => setFailedSrc(validated)}
        className="max-h-[400px] max-w-full rounded-md border border-border/40 object-contain align-middle"
      />
    </span>
  );
}
