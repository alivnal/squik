/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialIcon from './MaterialIcon';
import PanelMascot from './mascot/PanelMascot';
import {
  PanelBody,
  PanelFooter,
  ScreenPanel,
} from './ScreenPanel';

interface CompressionErrorProps {
  message: string;
  /** The failed job, which names it in the title. */
  job?: 'compress' | 'merge' | 'trim';
  /** Runs the same job again with the same files. */
  onRetry?: () => void;
  /** Back to the card with the same files and ranges, to change them. */
  onChangeFiles?: () => void;
}

export default function CompressionError({ message, job = 'compress', onRetry, onChangeFiles }: CompressionErrorProps) {
  const { t } = useTranslation();

  return (
    <div>
      <ScreenPanel size="lg" className="z-10">
        <PanelBody className="flex flex-col items-center text-center gap-space-4 pt-space-6">
          <PanelMascot variant="error" size="lg" />

          <div className="space-y-space-2">
            <h1 tabIndex={-1} className="text-title font-semibold text-balance text-ink">
              {t(`errors.failedTitle.${job}`)}
            </h1>
            <p role="alert" className="text-body-sm text-error text-pretty max-w-[40ch] mx-auto">{message}</p>
          </div>
        </PanelBody>

        {(onRetry || onChangeFiles) && (
          <PanelFooter className="flex flex-col gap-space-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="pixel-btn pixel-btn-block"
              >
                <MaterialIcon name="refresh" size={20} />
                {t('common.tryAgain')}
              </button>
            )}
            {onChangeFiles && (
              <button
                type="button"
                onClick={onChangeFiles}
                className="pixel-btn pixel-btn-secondary pixel-btn-block"
              >
                <MaterialIcon name="arrow_back" size={20} />
                {t('common.changeFiles')}
              </button>
            )}
          </PanelFooter>
        )}
      </ScreenPanel>
    </div>
  );
}
