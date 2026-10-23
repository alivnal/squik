/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_OUTPUT_BYTES, formatBytes } from '@/lib/squish-core';
import MaterialIcon from './MaterialIcon';
import BeaverCompressionScene from './mascot/BeaverCompressionScene';
import SquikHero from './SquikHero';
import {
  PanelBody,
  PanelDivider,
  PanelFooter,
  PanelHeader,
  ScreenPanel,
} from './ScreenPanel';
import { formatElapsed, type CompressionProgressSnapshot } from '@/lib/compress-progress';

export type CompressionPhase = 'merging' | 'trimming' | 'compressing';

interface CompressionStatusProps {
  filename: string;
  progressSnap: CompressionProgressSnapshot;
  jobStartedAt: number;
  encodeStartedAt: number | null;
  originalSize?: number;
  wasmLoading?: boolean;
  phase?: CompressionPhase;
  /** The running job, which picks the diorama shown beside the panel. */
  job?: 'compress' | 'merge' | 'trim';
  onCancel: () => void;
}

export default function CompressionStatus({
  filename,
  progressSnap,
  jobStartedAt,
  encodeStartedAt,
  originalSize,
  wasmLoading = false,
  phase = 'compressing',
  job = 'compress',
  onCancel,
}: CompressionStatusProps) {
  const { t } = useTranslation();
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedMs = Date.now() - jobStartedAt;
  const encodeElapsedMs = encodeStartedAt ? Date.now() - encodeStartedAt : null;
  const percentage = Math.min(100, Math.max(0, Math.round(progressSnap.progress * 100)));

  const phaseTitle =
    phase === 'merging'
      ? t('status.mergingVideos')
      : phase === 'trimming'
        ? t('status.trimmingVideo')
        : wasmLoading
        ? t('status.loadingEncoder')
        : progressSnap.progress >= 1
          ? t('phase.complete')
          : progressSnap.phase
            ? t(`phase.${progressSnap.phase}`, { defaultValue: progressSnap.phaseLabel })
            : progressSnap.phaseLabel;

  return (
    // The job's own diorama plays beside the panel while it runs, placed the
    // way the homepage hero is.
    <section className="tool-layout job-layout">
      <SquikHero scene={job} />
      <div className="scene-card">
        <ScreenPanel size="lg" className="z-10">
          <PanelHeader>
            <h1 tabIndex={-1} className="flex items-center justify-center gap-2 text-headline-sm text-ink">
              <MaterialIcon name="movie" filled className="text-accent shrink-0" size={20} />
              <span className="truncate max-w-[min(100%,260px)]">{filename}</span>
            </h1>
            <p className="mt-space-1 text-body-sm leading-5 text-muted">
              {/* The 200 MB target only means something when the source is over it. */}
              {originalSize
                ? originalSize > MAX_OUTPUT_BYTES
                  ? t('common.originalTarget', { size: formatBytes(originalSize) })
                  : t('common.original', { size: formatBytes(originalSize) })
                : t('common.targetUnderMb')}
            </p>
          </PanelHeader>

          <PanelDivider />

          <PanelBody className="flex flex-col items-center">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              aria-label={phaseTitle}
              className="w-full"
            >
              <BeaverCompressionScene progress={progressSnap.progress} percentage={percentage} />
            </div>

            <div className="status-details mt-space-6 text-center w-full">
              <p className="text-headline-sm leading-[30px] text-accent" aria-live="polite">
                {phaseTitle}
              </p>

              <div className="status-times mt-space-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <MaterialIcon name="timer" size={16} />
                  {t('status.elapsed', { time: formatElapsed(elapsedMs) })}
                </span>
                {encodeElapsedMs !== null && (
                  <span className="inline-flex items-center gap-1 text-accent">
                    <MaterialIcon name="movie_filter" size={16} />
                    {t('status.encoding', { time: formatElapsed(encodeElapsedMs) })}
                  </span>
                )}
              </div>

              <p className="status-note text-body-sm leading-5 text-muted mt-space-2 max-w-sm mx-auto">
                {wasmLoading ? t('status.wasmHint') : t('status.keepTabOpen')}
              </p>
            </div>
          </PanelBody>

          <PanelFooter>
            <button
              type="button"
              onClick={onCancel}
              className="pixel-btn pixel-btn-secondary pixel-btn-block"
            >
              <MaterialIcon name="cancel" size={18} />
              {t('status.cancel')}
            </button>
          </PanelFooter>
        </ScreenPanel>
      </div>
    </section>
  );
}
