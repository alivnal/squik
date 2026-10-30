/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// The wordmark, drawn rather than set in a font: "squik" on a 25 x 9 pixel
// grid, one-unit strokes, a five-row x-height with the k rising and the q
// dropping two rows. Shown at whole multiples of the grid so it stays crisp.
const WORDMARK_PATH =
  'M0 2h5v1h-5zM0 3h1v1h-1zM0 4h5v1h-5zM4 5h1v1h-1zM0 6h5v1h-5zM6 2h5v1h-5zM6 3h1v1h-1zM10 3h1v1h-1zM6 4h1v1h-1zM10 4h1v1h-1zM6 5h1v1h-1zM10 5h1v1h-1zM6 6h5v1h-5zM10 7h1v1h-1zM10 8h1v1h-1zM12 2h1v1h-1zM16 2h1v1h-1zM12 3h1v1h-1zM16 3h1v1h-1zM12 4h1v1h-1zM16 4h1v1h-1zM12 5h1v1h-1zM16 5h1v1h-1zM12 6h5v1h-5zM18 0h1v1h-1zM18 2h1v1h-1zM18 3h1v1h-1zM18 4h1v1h-1zM18 5h1v1h-1zM18 6h1v1h-1zM20 0h1v1h-1zM20 1h1v1h-1zM20 2h1v1h-1zM24 2h1v1h-1zM20 3h1v1h-1zM23 3h1v1h-1zM20 4h3v1h-3zM20 5h1v1h-1zM23 5h1v1h-1zM20 6h1v1h-1zM24 6h1v1h-1z';

interface SquikLogoProps {
  className?: string;
  compact?: boolean;
}

export default function SquikLogo({ className = '', compact = false }: SquikLogoProps) {
  return (
    <span className={`squik-brand ${compact ? 'squik-brand-compact' : ''} ${className}`.trim()}>
      <img
        className="squik-brand-mark"
        src="/icon.svg"
        alt=""
        width="48"
        height="48"
        aria-hidden="true"
      />
      {!compact && (
        <svg
          className="squik-brand-name"
          viewBox="0 0 25 9"
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <path fill="currentColor" d={WORDMARK_PATH} />
        </svg>
      )}
    </span>
  );
}
