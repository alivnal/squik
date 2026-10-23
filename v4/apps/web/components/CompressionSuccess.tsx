/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes, type WebCompressionResult } from '@/lib/squish-core';
import { formatElapsed } from '@/lib/compress-progress';
import { nativeOutput } from '@/lib/platform';
import MaterialIcon from './MaterialIcon';
import PanelMascot from './mascot/PanelMascot';
import ShareTargets from './ShareTargets';
import SquikHero from './SquikHero';
import { PanelBody, ScreenPanel } from './ScreenPanel';

/** Desktop only: where the result stands with the native Save sheet. */
type SaveState = { status: 'asking' | 'cancelled' } | { status: 'saved'; path: string };

type Job = 'compress' | 'merge' | 'trim';

interface CompressionSuccessProps {
  result: WebCompressionResult;
  /** The finished job, which picks the title, the copy and the diorama. */
  job?: Job;
  onReset: () => void;
}

type Stat = { label: string; value: string; className?: string };

export default function CompressionSuccess({ result, job = 'compress', onReset }: CompressionSuccessProps) {
  const { t } = useTranslation();
  const [save, setSave] = useState<SaveState>({ status: 'asking' });
  const askedFor = useRef<string | null>(null);

  const saveResult = useCallback(async () => {
    if (!nativeOutput) return;
    setSave({ status: 'asking' });
    try {
      const path = await nativeOutput.save(result.outputUrl);
      setSave(path ? { status: 'saved', path } : { status: 'cancelled' });
    } catch (error) {
      console.error(error);
      setSave({ status: 'cancelled' });
    }
  }, [result.outputUrl]);

  // Desktop: ask where to keep the file as soon as it is ready, instead of a
  // download link; the ref keeps a re-run effect from asking twice.
  useEffect(() => {
    if (!nativeOutput || askedFor.current === result.outputUrl) return;
    askedFor.current = result.outputUrl;
    void saveResult();
  }, [result.outputUrl, saveResult]);

  // A compress job that found the file already small enough hands it back
  // untouched; say so instead of celebrating a 0% saving.
  const outcome = job === 'compress' && result.skippedEncode ? 'fits' : job;
  const description =
    outcome === 'merge'
      ? t('success.description.merge', { count: result.clipCount ?? 2 })
      : outcome === 'trim'
        ? t('success.description.trim', { count: result.trimSegmentCount ?? 1 })
        : t(`success.description.${outcome}`);

  const { originalSize, compressedSize } = result;
  const stats: Stat[] = [];
  if (compressedSize === originalSize) {
    stats.push({ label: t('success.size'), value: formatBytes(compressedSize) });
    stats.push({ label: t('success.limit'), value: t('common.mbLimit') });
  } else {
    stats.push({ label: t('success.original'), value: formatBytes(originalSize) });
    stats.push({ label: t('success.newSize'), value: formatBytes(compressedSize), className: 'text-accent' });
    // Trim and merge can come out larger than what went in; report that as it
    // is rather than clamping it to a 0% saving.
    const change = originalSize > 0 ? Math.round((Math.abs(originalSize - compressedSize) / originalSize) * 100) : 0;
    stats.push(
      compressedSize < originalSize
        ? { label: t('success.saved'), value: t('success.percent', { value: change }), className: 'text-success' }
        : { label: t('success.larger'), value: t('success.percent', { value: change }) },
    );
  }
  // Under a second would read as 00:00.
  if (!result.skippedEncode && result.encodeTimeMs != null && result.encodeTimeMs >= 1000) {
    stats.push({ label: t('success.encodeTime'), value: formatElapsed(result.encodeTimeMs) });
  }

  return (
    // The finished job's diorama stays beside the panel, placed as it was while
    // the job ran.
    <section className="tool-layout job-layout">
      <SquikHero scene={job} />
      <div className="scene-card">
        <ScreenPanel size="lg" className="z-10">
          <PanelBody className="text-center pt-space-6 pb-space-6">
            <div className="success-mascot mx-auto mb-space-4 flex items-center justify-center">
              <PanelMascot variant="confetti" size="xl" />
            </div>

            <h1 tabIndex={-1} className="text-[clamp(1.375rem,4vw,1.875rem)] leading-tight text-ink mb-space-2">
              {t(`success.title.${outcome}.before`)}{' '}
              <span className="text-success">{t(`success.title.${outcome}.accent`)}</span>
              {t(`success.title.${outcome}.after`)}
            </h1>
            <p className="success-description text-body-sm leading-5 text-muted mb-space-6 max-w-md mx-auto">
              {description}
            </p>

            <div className="success-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="panel-stat success-stat">
                  <span className="panel-stat-label">{stat.label}</span>
                  <span className={`panel-stat-value text-headline-sm ${stat.className ?? ''}`}>{stat.value}</span>
                </div>
              ))}
            </div>

            <p className="mt-space-4 text-body-sm leading-5 text-muted break-all px-1">
              {save.status === 'saved' ? save.path : result.filename}
            </p>

            <div className="action-btn-row">
              {!nativeOutput ? (
                <a
                  href={result.outputUrl}
                  download={result.filename}
                  className="pixel-btn no-underline"
                >
                  <MaterialIcon name="download" size={18} />
                  {t('success.downloadFile')}
                </a>
              ) : save.status === 'saved' ? (
                <button type="button" onClick={() => nativeOutput?.reveal(save.path)} className="pixel-btn">
                  <MaterialIcon name="folder_open" size={18} />
                  {t('success.showInFolder')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void saveResult()}
                  disabled={save.status === 'asking'}
                  className="pixel-btn"
                >
                  <MaterialIcon name="download" size={18} />
                  {t('success.downloadFile')}
                </button>
              )}
              <button type="button" onClick={onReset} className="pixel-btn pixel-btn-secondary">
                <MaterialIcon name="add_circle" size={18} />
                {t(`success.another.${job}`)}
              </button>
            </div>

            {nativeOutput && <ShareTargets outputUrl={result.outputUrl} actions={nativeOutput} />}
          </PanelBody>
        </ScreenPanel>
      </div>
    </section>
  );
}
