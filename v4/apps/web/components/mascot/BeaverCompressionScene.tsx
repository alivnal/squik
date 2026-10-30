/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { PixelRing } from '../PixelLoaders';

const MascotSvgSeq = dynamic(() => import('./MascotSvgSeq'), { ssr: false });

interface BeaverCompressionSceneProps {
  progress: number;
  percentage: number;
}

export default function BeaverCompressionScene({ progress, percentage }: BeaverCompressionSceneProps) {
  const intensity = 0.85 + progress * 0.55;
  // Turkish writes the sign first: %45.
  const { i18n } = useTranslation();
  const signFirst = i18n.language.startsWith('tr');
  // 24px keeps the Silkscreen sign on its 8px pixel grid.
  const sign = <span className="text-[1.5rem] leading-none text-muted">%</span>;

  return (
    <div className="flex flex-col items-center gap-space-4 w-full">
      <div className="relative w-40 h-40 sm:w-48 sm:h-48 shrink-0">
        <PixelRing progress={progress}>
          <MascotSvgSeq sequence="gym" variant="gym" size={84} intensity={intensity} />
        </PixelRing>
      </div>

      <p className="font-pixel text-figure leading-none tabular-nums text-ink">
        {signFirst && sign}
        {percentage}
        {!signFirst && sign}
      </p>
    </div>
  );
}
