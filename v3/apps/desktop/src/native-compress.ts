/**
 * Desktop stand-in for the web app's lib/compress-wasm: the same exports, backed
 * by the native FFmpeg jobs in the Electron main process instead of WASM.
 */

import {
  CompressionCancelledError,
  formatBytes,
  type TrimSegment,
  type VideoProbeMetadata,
  type WebCompressionResult,
} from '@/lib/squish-core';
import { CompressJobProgress, type CompressionProgressSnapshot } from '@/lib/compress-progress';
import { getI18nInstance } from '@squish/i18n';
import { ENCODER_LABEL } from './platform';
import type { NativeJob, NativeJobProgress } from '../electron/contracts';

export type { CompressionProgressSnapshot };


interface JobOptions {
  onProgress?: (snapshot: CompressionProgressSnapshot) => void;
  onLoadProgress?: (progress: number) => void;
}

function desktop() {
  if (!window.squikDesktop) throw new Error(getI18nInstance().t('errors.bridgeUnavailable'));
  return window.squikDesktop;
}

function pathFor(file: File): string {
  const path = desktop().pathForFile(file);
  if (!path) throw new Error(getI18nInstance().t('errors.dropPathFailed'));
  return path;
}

// ipcRenderer.invoke wraps main-process errors as
// "Error invoking remote method 'x': Error: <message>".
function unwrapIpcError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const message = error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  return /cancel/i.test(message) ? new CompressionCancelledError() : new Error(message);
}

export async function probeVideoFile(file: File): Promise<VideoProbeMetadata> {
  try {
    const metadata = await desktop().probe(pathFor(file));
    return { ...metadata, name: file.name };
  } catch (error) {
    throw unwrapIpcError(error);
  }
}

export function cancelWasmCompression(): void {
  void window.squikDesktop?.cancelJob();
}

/** A long job usually finishes while the user is in another app; tell them. */
function notifyIfInBackground(kind: NativeJob['kind'], result: { filename: string; compressedSize: number; skippedEncode: boolean }): void {
  if (document.hasFocus() || typeof Notification === 'undefined') return;
  const t = getI18nInstance().t.bind(getI18nInstance());
  // The same title the success screen shows.
  const outcome = kind === 'compress' && result.skippedEncode ? 'fits' : kind;
  const title = ['before', 'accent', 'after'].map((part) => t(`success.title.${outcome}.${part}`));
  new Notification(`${title[0]} ${title[1]}${title[2]}`, {
    body: `${result.filename} · ${formatBytes(result.compressedSize)}`,
    // Main plays the finish sound; a second chime from the banner would double it.
    silent: true,
  });
}

async function runNativeJob(job: NativeJob, options?: JobOptions): Promise<WebCompressionResult> {
  const api = desktop();
  const jobId = crypto.randomUUID();
  const jobProgress = new CompressJobProgress(options?.onProgress);
  jobProgress.enterPhase('preparing', 0);
  // There is no encoder to download on desktop.
  options?.onLoadProgress?.(1);

  const stopListening = api.onJobProgress((progress: NativeJobProgress) => {
    if (progress.jobId !== jobId) return;
    if (progress.stage === 'encoding') {
      jobProgress.setEncodeAttempt(0, progress.ratio);
    } else {
      jobProgress.enterPhase(progress.stage, progress.ratio);
    }
  });

  try {
    const result = await api.runJob(jobId, job);
    jobProgress.finish();
    notifyIfInBackground(job.kind, result);
    return {
      ...result,
      outputPath: result.filename,
      encoderLabel: ENCODER_LABEL,
      // The file stays on disk in the main process; the UI only uses outputUrl.
      outputBlob: new Blob(),
    };
  } catch (error) {
    throw unwrapIpcError(error);
  } finally {
    stopListening();
  }
}

export async function compressVideoWasm(file: File, options?: JobOptions): Promise<WebCompressionResult> {
  return runNativeJob({ kind: 'compress', path: pathFor(file) }, options);
}

export async function mergeAndCompressVideosWasm(
  files: File[],
  options?: JobOptions,
): Promise<WebCompressionResult> {
  if (files.length < 2) throw new Error(getI18nInstance().t('errors.mergeMinTwo'));
  return runNativeJob({ kind: 'merge', paths: files.map(pathFor) }, options);
}

export async function trimAndCompressVideosWasm(
  file: File,
  deleteSegments: TrimSegment[],
  options?: JobOptions,
): Promise<WebCompressionResult> {
  return runNativeJob({ kind: 'trim', path: pathFor(file), deleteSegments }, options);
}
