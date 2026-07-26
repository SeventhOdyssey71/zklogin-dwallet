import { ImageResponse } from 'next/og';
import { MARK_PATH, MARK_STROKE_WIDTH } from '@/components/brand/Logo';

/**
 * Favicon: the ycos mark, white on black, rasterised at build time.
 *
 * This replaces the hand-rolled `data:image/svg+xml` favicon that used to live in `metadata.icons`.
 * A data-URI SVG is tempting (no request, infinitely scalable) but it renders with the *browser's*
 * SVG stack at 16px with no hinting, and Safari historically ignores SVG favicons in pinned tabs.
 * A pre-rasterised PNG from the file convention gets the geometry we chose rather than the geometry
 * the tab bar felt like drawing.
 *
 * Geometry is imported from the component rather than retyped so the tab icon cannot silently drift
 * from the in-app logo — the single most common way a rebrand ends up half-applied.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      // Satori supports only a subset of CSS: flexbox with explicit `display: flex`, no `gap`, no
      // shorthand-heavy properties. The black tile is a div rather than an SVG <rect> because satori
      // rounds div corners reliably at this size, and no text means no font has to be fetched here.
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: '#000000',
          borderRadius: 7,
        }}
      >
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none">
          <path
            d={MARK_PATH}
            stroke="#ffffff"
            strokeWidth={MARK_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size
  );
}
