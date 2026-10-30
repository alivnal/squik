/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/*
 * Loaders drawn on the same grid as the wordmark and PixelText: square cells,
 * motion in whole steps rather than slides. All timing lives in CSS, where
 * prefers-reduced-motion holds each one still.
 */

const RING_SIDE = 16;

// The ring's cells clockwise from the top centre; corners are cut, like the
// alphabet's digits, so a 16-cell side gives 56 cells.
const RING_CELLS: [number, number][] = (() => {
  const n = RING_SIDE;
  const points: [number, number][] = [];
  for (let x = 1; x < n - 1; x++) points.push([x, 0]);
  for (let y = 1; y < n - 1; y++) points.push([n - 1, y]);
  for (let x = n - 2; x > 0; x--) points.push([x, n - 1]);
  for (let y = n - 2; y > 0; y--) points.push([0, y]);
  const start = points.findIndex(([x, y]) => y === 0 && x === n / 2);
  return [...points.slice(start), ...points.slice(0, start)];
})();

/**
 * Progress as a square ring of cells that fill one by one; the next cell
 * blinks while it waits, and the whole ring flashes twice when it's done.
 * Sized by its box; the children sit in the middle.
 */
export function PixelRing({ progress, children }: { progress: number; children?: React.ReactNode }) {
  const lit = Math.floor(Math.min(1, Math.max(0, progress)) * RING_CELLS.length);
  const done = progress >= 1;
  return (
    <div className={`pixel-ring ${done ? 'is-done' : ''}`} aria-hidden="true">
      {RING_CELLS.map(([x, y], i) => (
        <span
          key={i}
          className={`pixel-ring-cell ${i < lit ? 'is-on' : ''} ${i === lit && !done ? 'is-head' : ''}`}
          style={{ left: `${(x * 100) / RING_SIDE}%`, top: `${(y * 100) / RING_SIDE}%` }}
        />
      ))}
      <div className="pixel-ring-center">{children}</div>
    </div>
  );
}

// The 3 x 3 grid's outer cells, clockwise; the centre stays dark.
const DOT_PATH = [0, 1, 2, 5, 8, 7, 6, 3];

/** Busy, with no share to show: the outer cells of a 3 x 3 grid light in turn. */
export function PixelDots({ size = 'sm', className = '' }: { size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span className={`pixel-dots pixel-dots-${size} ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const step = DOT_PATH.indexOf(i);
        return (
          <i
            key={i}
            style={step >= 0 ? ({ '--dot-step': step } as React.CSSProperties) : undefined}
            className={step >= 0 ? 'is-path' : ''}
          />
        );
      })}
    </span>
  );
}

/**
 * Three dots drawn one, two, three, then gone, in the alphabet's dot; the
 * slot keeps its width so the line never moves. Sized by --pixel-unit.
 */
export function PixelWait({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`pixel-wait ${className}`.trim()}
      viewBox="0 0 5 9"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="6" width="1" height="1" fill="currentColor" />
      <rect x="2" y="6" width="1" height="1" fill="currentColor" />
      <rect x="4" y="6" width="1" height="1" fill="currentColor" />
    </svg>
  );
}
