/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OutputTooLargeError, MAX_OUTPUT_BYTES, AppStatus, type TrimSegment, type VideoMetadata, type WebCompressionResult } from '@/lib/squish-core';
import AppShell from '@/components/AppShell';
import ScreenTransition from '@/components/ScreenTransition';
import VideoSelector, { type SelectorDraft } from '@/components/VideoSelector';
import CompressionStatus from '@/components/CompressionStatus';
import CompressionSuccess from '@/components/CompressionSuccess';
import CompressionError from '@/components/CompressionError';
import { DEFAULT_TARGET_MB, capBytesFor } from '@/components/TargetSize';
import {
  cancelWasmCompression,
  compressVideoWasm,
  mergeAndCompressVideosWasm,
  trimAndCompressVideosWasm,
  type CompressionProgressSnapshot,
} from '@/lib/compress-wasm';

const INITIAL_SNAPSHOT: CompressionProgressSnapshot = {
  progress: 0,
  phase: 'preparing',
  phaseLabel: 'Preparing video…',
  elapsedMs: 0,
  encodeElapsedMs: null,
};

const TARGET_STORAGE_KEY = 'squik-target-mb';

type JobKind = 'compress' | 'merge' | 'trim';

/** What a job was started with, so it can run again or go back into the card. */
type JobInput =
  | { kind: 'compress'; file: File }
  | { kind: 'merge'; files: File[] }
  | { kind: 'trim'; file: File; deleteSegments: TrimSegment[]; rangeText: string };

function draftFor(job: JobInput | null): SelectorDraft | undefined {
  if (job?.kind === 'merge') return { clips: job.files };
  if (job?.kind === 'trim') return { trimVideo: job.file, rangeText: job.rangeText };
  return undefined;
}

export default function SquishApp() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [progressSnap, setProgressSnap] = useState<CompressionProgressSnapshot>(INITIAL_SNAPSHOT);
  const [errorMessage, setErrorMessage] = useState('');
  // False when the failure comes from the files themselves, so running the
  // same job again cannot help.
  const [retryHelps, setRetryHelps] = useState(true);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [result, setResult] = useState<WebCompressionResult | null>(null);
  const [wasmLoading, setWasmLoading] = useState(false);
  // How much of the encoder (~25 MB, first visit only) has downloaded, 0 to 1.
  const [encoderLoaded, setEncoderLoaded] = useState(0);
  const [jobKind, setJobKind] = useState<JobKind>('compress');
  // The size every job aims under: 200 MB unless the user locks another.
  // Remembered in this browser only, as a convenience.
  const [targetMb, setTargetMb] = useState(DEFAULT_TARGET_MB);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(TARGET_STORAGE_KEY));
      if (Number.isInteger(saved) && saved > 0) setTargetMb(saved);
    } catch {
      // Storage can be unavailable; the default stands.
    }
  }, []);
  const changeTarget = (mb: number) => {
    setTargetMb(mb);
    try {
      if (mb === DEFAULT_TARGET_MB) localStorage.removeItem(TARGET_STORAGE_KEY);
      else localStorage.setItem(TARGET_STORAGE_KEY, String(mb));
    } catch {
      // Not remembered, still used for this visit.
    }
  };
  const maxOutputBytes = capBytesFor(targetMb);
  // Files and ranges the card opens with: the cancelled job's, else none.
  const [draft, setDraft] = useState<SelectorDraft | undefined>(undefined);
  const lastJobRef = useRef<JobInput | null>(null);

  const compressionSessionRef = useRef(0);
  const outputUrlRef = useRef<string | null>(null);
  const jobStartedAtRef = useRef<number | null>(null);
  const encodeStartedAtRef = useRef<number | null>(null);

  const revokeOutputUrl = () => {
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }
  };

  useEffect(() => () => revokeOutputUrl(), []);

  const invalidateCompressionSession = () => {
    compressionSessionRef.current += 1;
    cancelWasmCompression();
    // jobKind stays: the selector reopens on the last job's tab.
    jobStartedAtRef.current = null;
    encodeStartedAtRef.current = null;
  };

  const beginCompressionSession = () => {
    compressionSessionRef.current += 1;
    jobStartedAtRef.current = Date.now();
    encodeStartedAtRef.current = null;
    return compressionSessionRef.current;
  };

  const reset = () => {
    invalidateCompressionSession();
    revokeOutputUrl();
    setDraft(undefined);
    setStatus(AppStatus.IDLE);
    setMetadata(null);
    setResult(null);
    setProgressSnap(INITIAL_SNAPSHOT);
    setErrorMessage('');
    setWasmLoading(false);
  };

  // Back to the card with the job's files and ranges still in it: after a
  // cancel, or from the error screen to change them.
  const backToFiles = () => {
    // A finished job holds on "Complete" for a moment before the success
    // screen; a late Cancel then must not throw the result away.
    if (status === AppStatus.COMPRESSING && result) return;
    invalidateCompressionSession();
    revokeOutputUrl();
    setDraft(draftFor(lastJobRef.current));
    setStatus(AppStatus.IDLE);
    setMetadata(null);
    setResult(null);
    setProgressSnap(INITIAL_SNAPSHOT);
    setErrorMessage('');
    setWasmLoading(false);
  };

  // The encoder reports its download as it goes; loading ends only at 1, not
  // at the first report.
  const handleEncoderLoad = (session: number, ratio: number) => {
    if (session !== compressionSessionRef.current) return;
    setEncoderLoaded(ratio);
    setWasmLoading(ratio < 1);
  };

  const handleProgress = (session: number, snap: CompressionProgressSnapshot) => {
    if (session !== compressionSessionRef.current) return;
    if (snap.encodeElapsedMs !== null && encodeStartedAtRef.current === null) {
      encodeStartedAtRef.current = Date.now() - snap.encodeElapsedMs;
    }
    setProgressSnap(snap);
  };

  const finishJob = async (session: number, compression: WebCompressionResult) => {
    if (session !== compressionSessionRef.current) {
      URL.revokeObjectURL(compression.outputUrl);
      return;
    }

    outputUrlRef.current = compression.outputUrl;
    setResult(compression);
    setProgressSnap((prev) => ({ ...prev, progress: 1, phaseLabel: 'Complete' }));
    setWasmLoading(false);
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    if (session !== compressionSessionRef.current) return;
    setStatus(AppStatus.DONE);
  };

  const handleJobError = (session: number, err: unknown) => {
    if (session !== compressionSessionRef.current) return;

    const message = err instanceof Error ? err.message : t('errors.compressionFailed');
    if (!message.toLowerCase().includes('cancel')) {
      setStatus(AppStatus.ERROR);
      setErrorMessage(message);
      setRetryHelps(
        !(err instanceof OutputTooLargeError) &&
          !['errors.metadataReadFailed', 'errors.mergeMinTwo'].some((key) => t(key) === message),
      );
    } else {
      setDraft(draftFor(lastJobRef.current));
      setStatus(AppStatus.IDLE);
      setMetadata(null);
      setResult(null);
      setProgressSnap(INITIAL_SNAPSHOT);
      setErrorMessage('');
    }
    setWasmLoading(false);
  };

  const startCompression = async (file: File) => {
    const session = beginCompressionSession();
    setJobKind('compress');
    lastJobRef.current = { kind: 'compress', file };

    setStatus(AppStatus.COMPRESSING);
    setProgressSnap(INITIAL_SNAPSHOT);
    setErrorMessage('');
    setResult(null);
    setWasmLoading(true);
    setEncoderLoaded(0);
    setMetadata({ name: file.name, size: file.size });

    try {
      const compression = await compressVideoWasm(file, {
        onLoadProgress: (ratio) => handleEncoderLoad(session, ratio),
        onProgress: (snap) => handleProgress(session, snap),
        maxOutputBytes,
      });
      await finishJob(session, compression);
    } catch (err) {
      handleJobError(session, err);
    }
  };

  const startMergeAndCompress = async (files: File[]) => {
    const session = beginCompressionSession();
    setJobKind('merge');
    lastJobRef.current = { kind: 'merge', files };

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    setStatus(AppStatus.COMPRESSING);
    setProgressSnap(INITIAL_SNAPSHOT);
    setErrorMessage('');
    setResult(null);
    setWasmLoading(true);
    setEncoderLoaded(0);
    setMetadata({
      name: t('status.clips', { count: files.length }),
      size: totalSize,
    });

    try {
      const compression = await mergeAndCompressVideosWasm(files, {
        onLoadProgress: (ratio) => handleEncoderLoad(session, ratio),
        onProgress: (snap) => handleProgress(session, snap),
        maxOutputBytes,
      });
      await finishJob(session, compression);
    } catch (err) {
      handleJobError(session, err);
    }
  };

  const startTrimAndCompress = async (file: File, deleteSegments: TrimSegment[], rangeText: string) => {
    const session = beginCompressionSession();
    setJobKind('trim');
    lastJobRef.current = { kind: 'trim', file, deleteSegments, rangeText };

    setStatus(AppStatus.COMPRESSING);
    setProgressSnap(INITIAL_SNAPSHOT);
    setErrorMessage('');
    setResult(null);
    setWasmLoading(true);
    setEncoderLoaded(0);
    setMetadata({ name: file.name, size: file.size });

    try {
      const compression = await trimAndCompressVideosWasm(file, deleteSegments, {
        onLoadProgress: (ratio) => handleEncoderLoad(session, ratio),
        onProgress: (snap) => handleProgress(session, snap),
        maxOutputBytes,
      });
      await finishJob(session, compression);
    } catch (err) {
      handleJobError(session, err);
    }
  };

  // The same files and ranges again, straight from the error screen.
  const retryLastJob = () => {
    const job = lastJobRef.current;
    if (!job) return reset();
    revokeOutputUrl();
    if (job.kind === 'compress') void startCompression(job.file);
    else if (job.kind === 'merge') void startMergeAndCompress(job.files);
    else void startTrimAndCompress(job.file, job.deleteSegments, job.rangeText);
  };

  const jobPhase =
    jobKind === 'merge' && progressSnap.progress < 0.35
      ? 'merging'
      : jobKind === 'trim' && progressSnap.progress < 0.35
        ? 'trimming'
        : 'compressing';

  let content: React.ReactNode = null;

  if (status === AppStatus.IDLE) {
    content = (
      <VideoSelector
        onVideoSelected={startCompression}
        onMergeAndCompress={startMergeAndCompress}
        onTrimAndCompress={startTrimAndCompress}
        targetMb={targetMb}
        onTargetChange={changeTarget}
        disabled={false}
        initialMode={jobKind}
        initialDraft={draft}
      />
    );
  } else if (status === AppStatus.COMPRESSING && metadata) {
    content = (
      <CompressionStatus
        filename={metadata.name}
        targetMb={targetMb}
        maxOutputBytes={maxOutputBytes ?? MAX_OUTPUT_BYTES}
        progressSnap={progressSnap}
        jobStartedAt={jobStartedAtRef.current ?? Date.now()}
        encodeStartedAt={encodeStartedAtRef.current}
        originalSize={metadata.size}
        wasmLoading={wasmLoading}
        encoderLoaded={encoderLoaded}
        phase={jobPhase}
        job={jobKind}
        onCancel={backToFiles}
      />
    );
  } else if (status === AppStatus.DONE && result) {
    content = <CompressionSuccess result={result} job={jobKind} targetMb={targetMb} onReset={reset} />;
  } else if (status === AppStatus.ERROR) {
    content = (
      <CompressionError
        message={errorMessage}
        job={jobKind}
        retryHelps={retryHelps}
        onRetry={retryLastJob}
        onChangeFiles={backToFiles}
      />
    );
  }

  return (
    <AppShell>
      <ScreenTransition screenKey={status}>{content}</ScreenTransition>
    </AppShell>
  );
}
