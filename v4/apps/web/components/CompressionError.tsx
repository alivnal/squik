/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialIcon from './MaterialIcon';
import PanelMascot from './mascot/PanelMascot';
import SquikHero from './SquikHero';
import {
  PanelBody,
  PanelFooter,
  ScreenPanel,
} from './ScreenPanel';

interface CompressionErrorProps {
  message: string;
  /** The failed job, which names it in the title and picks the scene. */
  job?: 'compress' | 'merge' | 'trim';
  /** False when the files themselves are the problem: changing them leads. */
  retryHelps?: boolean;
  /** Runs the same job again with the same files. */
  onRetry?: () => void;
  /** Back to the card with the same files and ranges, to change them. */
  onChangeFiles?: () => void;
}

export default function CompressionError({
  message,
  job = 'compress',
  retryHelps = true,
  onRetry,
  onChangeFiles,
}: CompressionErrorProps) {
  const { t } = useTranslation();

  const retryButton = onRetry && (
    <button
      type="button"
      onClick={onRetry}
      className={`pixel-btn pixel-btn-block ${retryHelps ? '' : 'pixel-btn-secondary'}`}
    >
      <MaterialIcon name="refresh" size={20} />
      {t('common.tryAgain')}
    </button>
  );
  const changeButton = onChangeFiles && (
    <button
      type="button"
      onClick={onChangeFiles}
      className={`pixel-btn pixel-btn-block ${retryHelps ? 'pixel-btn-secondary' : ''}`}
    >
      <MaterialIcon name="arrow_back" size={20} />
      {t('common.changeFiles')}
    </button>
  );

  return (
    // The job's scene stays beside the panel, as on the job and success screens.
    <section className="tool-layout">
      <SquikHero scene={job} />
      <div className="scene-card">
        <ScreenPanel size="lg" className="z-10">
          <PanelBody className="flex flex-col items-center text-center gap-space-4 pt-space-6">
            <PanelMascot variant="error" size="lg" />

            <div className="space-y-space-2">
              <h1 tabIndex={-1} className="text-title font-semibold text-balance text-ink">
                {t(`errors.failedTitle.${job}`)}
              </h1>
              <p role="alert" className="text-body-sm text-error text-pretty max-w-[40ch] mx-auto [overflow-wrap:anywhere]">
                {message}
              </p>
            </div>
          </PanelBody>

          {(retryButton || changeButton) && (
            <PanelFooter className="flex flex-col gap-space-2">
              {retryHelps ? retryButton : changeButton}
              {retryHelps ? changeButton : retryButton}
            </PanelFooter>
          )}
        </ScreenPanel>
      </div>
    </section>
  );
}
