/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/lib/squish-core';
import FileName from './FileName';
import MaterialIcon from './MaterialIcon';
import PixelText from './PixelText';
import { PixelDots } from './PixelLoaders';
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

// Jobs shorter than this cancel at once; longer ones ask to confirm, and the
// confirmation lapses after a few seconds.
const CONFIRM_AFTER_MS = 5000;
const CONFIRM_WINDOW_MS = 4000;
// An encoder download that has not moved for this long is called out.
const STALL_AFTER_MS = 15000;

interface CompressionStatusProps {
  filename: string;
  progressSnap: CompressionProgressSnapshot;
  jobStartedAt: number;
  encodeStartedAt: number | null;
  originalSize?: number;
  wasmLoading?: boolean;
  /** The size the job aims under, in MB. */
  targetMb: number;
  /** The byte cap behind it, to tell whether the source is over it. */
  maxOutputBytes: number;
  /** Share of the encoder download done, 0 to 1, while wasmLoading. */
  encoderLoaded?: number;
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
  targetMb,
  maxOutputBytes,
  encoderLoaded = 0,
  phase = 'compressing',
  job = 'compress',
  onCancel,
}: CompressionStatusProps) {
  const { t, i18n } = useTranslation();
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Past a few seconds of work, Cancel asks once more before throwing it away.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  useEffect(() => {
    if (!confirmingCancel) return;
    const id = window.setTimeout(() => setConfirmingCancel(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(id);
  }, [confirmingCancel]);

  // When the encoder download last moved, to tell a slow connection from a
  // working one.
  const downloadMovedAt = useRef(Date.now());
  useEffect(() => {
    downloadMovedAt.current = Date.now();
  }, [encoderLoaded]);
  const downloadStalled = wasmLoading && Date.now() - downloadMovedAt.current > STALL_AFTER_MS;

  const elapsedMs = Date.now() - jobStartedAt;
  const finished = progressSnap.progress >= 1;
  const requestCancel = () => {
    if (finished) return;
    if (elapsedMs < CONFIRM_AFTER_MS || confirmingCancel) onCancel();
    else setConfirmingCancel(true);
  };
  const encodeElapsedMs = encodeStartedAt ? Date.now() - encodeStartedAt : null;
  const percentage = Math.min(100, Math.max(0, Math.round(progressSnap.progress * 100)));

  // The encoder download comes first: until it lands, no merging or trimming
  // is happening, whatever the job. The name is what screen readers hear; the
  // visible line adds the download percent, which would be noise read aloud.
  const phaseName = wasmLoading
    ? t('status.loadingEncoder')
    : phase === 'merging'
      ? t('status.mergingVideos')
      : phase === 'trimming'
        ? t('status.trimmingVideo')
        : progressSnap.progress >= 1
          ? t('phase.complete')
          : progressSnap.phase
            ? t(`phase.${progressSnap.phase}`, { defaultValue: progressSnap.phaseLabel })
            : progressSnap.phaseLabel;
  const phaseTitle =
    wasmLoading && encoderLoaded > 0
      ? t('status.loadingEncoderPercent', { percent: Math.floor(encoderLoaded * 100) })
      : phaseName;

  return (
    // The job's own diorama plays beside the panel while it runs, placed the
    // way the homepage hero is.
    <section className="tool-layout">
      <SquikHero scene={job} />
      <div className="scene-card">
        <ScreenPanel size="lg" className="z-10">
          <PanelHeader>
            <h1 tabIndex={-1} className="flex items-center justify-center gap-2 text-title font-semibold text-ink">
              <MaterialIcon name="movie" filled className="text-accent shrink-0" size={20} />
              <FileName name={filename} className="max-w-[min(100%,260px)]" />
            </h1>
            <p className="mt-space-1 text-body-sm leading-5 text-muted">
              {/* The target only means something when the source is over it. */}
              {originalSize
                ? originalSize > maxOutputBytes
                  ? t('common.originalTarget', { size: formatBytes(originalSize, 1, i18n.language), limit: targetMb })
                  : t('common.original', { size: formatBytes(originalSize, 1, i18n.language) })
                : t('common.targetUnderMb', { limit: targetMb })}
            </p>
          </PanelHeader>

          <PanelDivider />

          <PanelBody className="flex flex-col items-center">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              aria-label={phaseName}
              className="w-full"
            >
              <BeaverCompressionScene progress={progressSnap.progress} percentage={percentage} />
            </div>

            <div className="status-details mt-space-6 text-center w-full">
              <p className="status-phase text-accent" aria-hidden="true">
                {wasmLoading && <PixelDots />}
                <PixelText parts={phaseTitle} waiting />
              </p>
              <p className="sr-only" aria-live="polite">
                {phaseName}
              </p>

              <div className="status-times mt-space-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body-sm text-muted tabular-nums">
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

              <p className="status-note text-body-sm text-muted text-pretty mt-space-2 max-w-sm mx-auto">
                {downloadStalled
                  ? t('status.encoderStalled')
                  : wasmLoading
                    ? t('status.wasmHint')
                    : t('status.keepTabOpen')}
              </p>
            </div>
          </PanelBody>

          <PanelFooter>
            <button
              type="button"
              onClick={requestCancel}
              disabled={finished}
              className={`pixel-btn pixel-btn-secondary pixel-btn-block ${confirmingCancel ? 'is-confirming' : ''}`}
            >
              <MaterialIcon name="cancel" size={18} />
              {confirmingCancel ? t('status.cancelConfirm') : t('status.cancel')}
            </button>
          </PanelFooter>
        </ScreenPanel>
      </div>
    </section>
  );
}
