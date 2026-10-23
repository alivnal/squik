/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import dynamic from 'next/dynamic';

const MascotSvgSeq = dynamic(() => import('./MascotSvgSeq'), { ssr: false });

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface BeaverCompressionSceneProps {
  progress: number;
  percentage: number;
}

export default function BeaverCompressionScene({ progress, percentage }: BeaverCompressionSceneProps) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const intensity = 0.85 + progress * 0.55;

  return (
    <div className="flex flex-col items-center gap-space-4 w-full">
      <div className="progress-ring relative w-40 h-40 sm:w-48 sm:h-48 flex items-center justify-center shrink-0">
        <svg className="absolute w-full h-full" viewBox="0 0 120 120" aria-hidden>
          <circle
            className="text-gray-200"
            cx="60"
            cy="60"
            fill="transparent"
            r={RING_RADIUS}
            stroke="currentColor"
            strokeWidth="8"
          />
          <circle
            className="text-accent progress-ring-circle"
            cx="60"
            cy="60"
            fill="transparent"
            r={RING_RADIUS}
            stroke="currentColor"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="8"
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <MascotSvgSeq sequence="gym" variant="gym" size={84} intensity={intensity} />
        </div>
      </div>

      <p className="font-pixel text-figure leading-none tabular-nums text-ink">
        {percentage}
        <span className="text-title text-muted">%</span>
      </p>
    </div>
  );
}
