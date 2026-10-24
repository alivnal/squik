/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatBytes,
  formatTimestamp,
  mergeTrimSegments,
  parseDeleteRangeText,
  parseTimestampToSeconds,
  totalKeepDuration,
  validateDeleteSegments,
  type TrimSegment,
} from '@/lib/squish-core';
import { probeVideoFile } from '@/lib/compress-wasm';
import { useFlipList } from '@/hooks/useFlipList';
import CompressOIcon from './CompressOIcon';
import FileName from './FileName';
import MaterialIcon from './MaterialIcon';
import PanelMascot from './mascot/PanelMascot';
import SquikHero from './SquikHero';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv';
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;

export type SelectorMode = 'compress' | 'merge' | 'trim';

export interface ClipEntry {
  id: string;
  file: File;
}

/** Files and ranges to put back in the card, e.g. after a cancelled job. */
export interface SelectorDraft {
  clips?: File[];
  trimVideo?: File;
  rangeText?: string;
}

interface VideoSelectorProps {
  onVideoSelected: (file: File) => void;
  onMergeAndCompress: (files: File[]) => void;
  onTrimAndCompress: (file: File, deleteSegments: TrimSegment[], rangeText: string) => void;
  disabled?: boolean;
  /** The tab to open on: the last job's, so "Trim Another" lands in Trim. */
  initialMode?: SelectorMode;
  initialDraft?: SelectorDraft;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name);
}

function clipKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

// How long typing has to pause before a mistake in the ranges is shown.
const RANGE_ERROR_DELAY_MS = 900;

type RangeIssue =
  | { key: 'trim.lineFormat' | 'trim.lineOrder'; line: number }
  | { key: 'trim.linePastEnd'; line: number; time: string };

// Checks the typed ranges line by line as they are typed, so a mistake is
// named with its line before the job starts. Reads lines the same way
// parseDeleteRangeText does; line numbers count blank lines, as the box shows.
function checkRangeLines(
  text: string,
  durationSec: number,
): { segments: TrimSegment[]; issue: RangeIssue | null } {
  const segments: TrimSegment[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const line = i + 1;
    const match = trimmed.match(/^(.+?)\s*[-–]\s*(.+)$/);
    const start = match ? parseTimestampToSeconds(match[1]) : null;
    const end = match ? parseTimestampToSeconds(match[2]) : null;
    if (!match || start === null || end === null || start < 0) {
      return { segments, issue: { key: 'trim.lineFormat', line } };
    }
    if (start >= end) return { segments, issue: { key: 'trim.lineOrder', line } };
    if (end > durationSec) {
      return { segments, issue: { key: 'trim.linePastEnd', line, time: match[2].trim() } };
    }
    segments.push({ startSec: start, endSec: end });
  }
  return { segments, issue: null };
}

// An example range that fits the chosen video: from a quarter to halfway in.
function placeholderRange(durationSec: number): string | null {
  const whole = Math.floor(durationSec);
  if (whole < 2) return null;
  const start = Math.floor(whole / 4);
  const end = Math.max(start + 1, Math.floor(whole / 2));
  return `${formatTimestamp(start)} - ${formatTimestamp(end)}`;
}

export default function VideoSelector({
  onVideoSelected,
  onMergeAndCompress,
  onTrimAndCompress,
  disabled = false,
  initialMode = 'compress',
  initialDraft,
}: VideoSelectorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SelectorMode>(initialMode);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipEntry[]>(
    () => initialDraft?.clips?.map((file) => ({ id: clipKey(file), file })) ?? [],
  );
  const [trimVideo, setTrimVideo] = useState<File | null>(initialDraft?.trimVideo ?? null);
  const [trimDurationSec, setTrimDurationSec] = useState<number | null>(null);
  const [rangeText, setRangeText] = useState(initialDraft?.rangeText ?? '');
  const [trimProbing, setTrimProbing] = useState(false);
  // Every file is read when picked, the way each job reads it first anyway,
  // so an unreadable one is named here instead of failing a job later.
  const [checkingFile, setCheckingFile] = useState(false);
  const [clipHealth, setClipHealth] = useState<Record<string, 'checking' | 'ok' | 'bad'>>({});
  // Said aloud to screen readers only: tray moves and removals, and the trim
  // status once typing pauses.
  const [trayNotice, setTrayNotice] = useState('');
  // A mistake in the ranges shows once typing pauses or the box is left, so
  // a half-typed "00:10 - 00:2" isn't flagged mid-word.
  const [rangeErrorShown, setRangeErrorShown] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setRangeErrorShown(true), RANGE_ERROR_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [rangeText]);
  const pendingFocusRef = useRef<
    { kind: 'move'; id: string; control: 'earlier' | 'later' } | { kind: 'remove'; index: number } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clipListRef = useRef<HTMLUListElement>(null);
  const ignoreClickRef = useRef(false);
  const clipLayoutKey = clips.map((clip) => clip.id).join('|');
  const { captureBeforeUpdate: captureClipLayout } = useFlipList(clipListRef, clipLayoutKey);

  const selectTrimVideo = async (file: File) => {
    setTrimProbing(true);
    setError(null);
    setTrimVideo(file);
    setTrimDurationSec(null);

    try {
      const metadata = await probeVideoFile(file);
      if (!(metadata.duration > 0)) {
        // Without a length, no range can be checked against the end.
        setError(t('errors.trimLengthUnknown', { name: file.name }));
        setTrimVideo(null);
        return;
      }
      setTrimDurationSec(metadata.duration);
    } catch {
      setError(t('errors.unreadableFile', { name: file.name }));
      setTrimVideo(null);
    } finally {
      setTrimProbing(false);
    }
  };

  const checkClips = (entries: ClipEntry[]) => {
    for (const { id, file } of entries) {
      setClipHealth((prev) => ({ ...prev, [id]: 'checking' }));
      probeVideoFile(file).then(
        () => setClipHealth((prev) => ({ ...prev, [id]: 'ok' })),
        () => setClipHealth((prev) => ({ ...prev, [id]: 'bad' })),
      );
    }
  };

  // Files put back from a draft are read again: the trim video for its length,
  // the merge clips so a bad one shows as soon as the card opens. Once, for
  // the draft the card opened with.
  useEffect(() => {
    if (initialDraft?.trimVideo) void selectTrimVideo(initialDraft.trimVideo);
    checkClips(clips);
  }, []);

  const addClips = (files: File[]) => {
    if (files.length === 0) return;
    const seen = new Set(clips.map((c) => c.id));
    const added: ClipEntry[] = [];
    for (const file of files) {
      if (!isVideoFile(file)) continue;
      const id = clipKey(file);
      if (!seen.has(id)) {
        seen.add(id);
        added.push({ id, file });
      }
    }
    if (added.length === 0) return;
    captureClipLayout();
    setClips((prev) => [...prev, ...added]);
    checkClips(added);
  };

  // Compress starts on pick, so the file is read first.
  const checkThenCompress = async (file: File) => {
    setCheckingFile(true);
    try {
      await probeVideoFile(file);
      onVideoSelected(file);
    } catch {
      setError(t('errors.unreadableFile', { name: file.name }));
    } finally {
      setCheckingFile(false);
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file || disabled || checkingFile) return;
    if (!isVideoFile(file)) {
      setError(t('errors.invalidFile'));
      return;
    }
    setError(null);
    if (mode === 'trim') {
      void selectTrimVideo(file);
      return;
    }
    void checkThenCompress(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (disabled) return;

    ignoreClickRef.current = true;
    window.setTimeout(() => {
      ignoreClickRef.current = false;
    }, 400);

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    if (mode === 'compress') {
      pickFile(files[0]);
      return;
    }

    if (mode === 'trim') {
      pickFile(files[0]);
      return;
    }

    const valid = files.filter(isVideoFile);
    if (valid.length === 0) {
      setError(t('errors.invalidFiles'));
      return;
    }
    setError(null);
    addClips(valid);
  };

  const handleZoneClick = () => {
    if (disabled || ignoreClickRef.current) return;
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';

    if (mode === 'compress') {
      pickFile(files[0]);
      return;
    }

    if (mode === 'trim') {
      pickFile(files[0]);
      return;
    }

    if (files.length === 0) return;
    const valid = files.filter(isVideoFile);
    if (valid.length === 0) {
      setError(t('errors.invalidFiles'));
      return;
    }
    setError(null);
    addClips(valid);
  };

  // Where focus goes once the tray has re-rendered: the moved clip's control
  // (or its other arrow, if that one just hit the end), or after a removal
  // the clip that took its place, else the one before, else the drop zone.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.kind === 'move') {
      const tile = clipListRef.current?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(pending.id)}"]`);
      const controls = ['earlier', 'later'] as const;
      const order = pending.control === 'earlier' ? controls : ([...controls].reverse() as Array<(typeof controls)[number]>);
      for (const control of order) {
        const button = tile?.querySelector<HTMLButtonElement>(`[data-control="${control}"]`);
        if (button && !button.disabled) return button.focus();
      }
      return;
    }
    const tiles = clipListRef.current?.querySelectorAll<HTMLElement>('.merge-tile');
    const target = tiles?.length
      ? tiles[Math.min(pending.index, tiles.length - 1)]
      : document.querySelector<HTMLElement>('[data-ui="video-drop-zone"]');
    target?.focus();
  }, [clipLayoutKey]);

  const moveClip = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= clips.length) return;
    const clip = clips[index];
    captureClipLayout();
    pendingFocusRef.current = { kind: 'move', id: clip.id, control: direction < 0 ? 'earlier' : 'later' };
    setClips((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setTrayNotice(t('merge.moved', { name: clip.file.name, position: target + 1, count: clips.length }));
  };

  const removeClip = (index: number) => {
    captureClipLayout();
    pendingFocusRef.current = { kind: 'remove', index };
    setTrayNotice(t('merge.removed', { name: clips[index].file.name }));
    setClips((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTrim = () => {
    if (!trimVideo) {
      setError(t('trim.pickVideoFirst'));
      return;
    }
    if (trimDurationSec == null) {
      setError(t('errors.trimProbeFailed'));
      return;
    }
    // A named mistake blocks the job, shown at once if it was still held back:
    // parseDeleteRangeText would otherwise drop that line and trim the rest.
    if (rangeStatus.tone === 'error') {
      setRangeErrorShown(true);
      return;
    }

    if (!rangeText.trim()) {
      setError(t('errors.trimRangeEmpty'));
      return;
    }

    const deleteSegments = parseDeleteRangeText(rangeText);
    if (deleteSegments.length === 0) {
      setError(t('errors.trimRangeInvalid'));
      return;
    }

    const validation = validateDeleteSegments(deleteSegments, trimDurationSec);
    if (validation === 'outOfBounds') {
      setError(
        t('errors.trimRangeOutOfBounds', {
          duration: formatTimestamp(trimDurationSec),
        }),
      );
      return;
    }
    if (validation === 'nothingLeft') {
      setError(t('errors.trimRangeNothingLeft'));
      return;
    }
    if (validation) {
      setError(t('errors.trimRangeInvalid'));
      return;
    }

    setError(null);
    onTrimAndCompress(trimVideo, deleteSegments, rangeText);
  };

  const unreadableClip = clips.find((clip) => clipHealth[clip.id] === 'bad');
  const clipsReady = clips.length >= 2 && clips.every((clip) => clipHealth[clip.id] === 'ok');

  const handleMerge = () => {
    if (clips.length < 2) {
      setError(t('errors.needTwoVideos'));
      return;
    }
    setError(null);
    onMergeAndCompress(clips.map((c) => c.file));
  };

  // Each tab keeps its own files: merge clips and the trim video and ranges
  // are still there when the user comes back.
  const switchMode = (nextMode: SelectorMode) => {
    setMode(nextMode);
    setError(null);
  };

  // What the typed ranges amount to: the first mistake, or the sections that
  // go and how much is left. Overlapping ranges count as one section.
  const rangeCheck =
    mode === 'trim' && trimDurationSec != null && rangeText.trim()
      ? checkRangeLines(rangeText, trimDurationSec)
      : null;
  const removedSections =
    rangeCheck && !rangeCheck.issue ? mergeTrimSegments(rangeCheck.segments) : [];
  const nothingLeft =
    trimDurationSec != null &&
    removedSections.length > 0 &&
    validateDeleteSegments(removedSections, trimDurationSec) === 'nothingLeft';
  let rangeStatus: { text: string; tone: 'hint' | 'ready' | 'error' } = {
    text: t('trim.rangesHint'),
    tone: 'hint',
  };
  if (rangeCheck?.issue) {
    rangeStatus = {
      text: t(rangeCheck.issue.key, {
        ...rangeCheck.issue,
        duration: formatTimestamp(trimDurationSec ?? 0),
      }),
      tone: 'error',
    };
  } else if (nothingLeft) {
    rangeStatus = { text: t('errors.trimRangeNothingLeft'), tone: 'error' };
  } else if (removedSections.length > 0 && trimDurationSec != null) {
    rangeStatus = {
      text: t('trim.summary', {
        count: removedSections.length,
        kept: formatTimestamp(totalKeepDuration(removedSections, trimDurationSec)),
        total: formatTimestamp(trimDurationSec),
      }),
      tone: 'ready',
    };
  }

  const shownStatus =
    rangeStatus.tone === 'error' && !rangeErrorShown
      ? { text: t('trim.rangesHint'), tone: 'hint' as const }
      : rangeStatus;

  // The trim status reaches screen readers once typing pauses, not on every
  // keystroke; a submit error goes at once.
  const trimStatusText = mode === 'trim' && trimVideo ? (error ?? shownStatus.text) : '';
  useEffect(() => {
    if (!trimStatusText) return;
    if (error) {
      setTrayNotice(error);
      return;
    }
    const id = window.setTimeout(() => setTrayNotice(trimStatusText), 900);
    return () => window.clearTimeout(id);
  }, [trimStatusText, error]);

  return (
    <section className="tool-layout">
      <input
        ref={fileInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple={mode === 'merge'}
        className="hidden"
        onChange={handleInputChange}
      />

      {isDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/90 pointer-events-none">
          <div className="drop-overlay">
            <CompressOIcon name="addMedia" size={52} />
            <p>{t('landing.dropAnywhere')}</p>
          </div>
        </div>
      )}

      <SquikHero />

      <div className="tool-ui" data-ui="video-compressor">
        <div className="tool-ui-body">
          {/* Each screen's h1 takes focus when the screen changes. The card
              shows no title; this one is for screen readers only. */}
          <h1 tabIndex={-1} className="sr-only">
            {t(`landing.${mode}Headline`)}
          </h1>

          <div className="tool-tabs" data-ui="mode-controls" role="group" aria-label={t('landing.tools')}>
            {(['compress', 'merge', 'trim'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={mode === tab}
                disabled={disabled}
                onClick={() => switchMode(tab)}
                className="tool-tab"
              >
                {t(`common.${tab}`)}
              </button>
            ))}
          </div>

          {mode === 'trim' && trimVideo ? (
            // Same tray as merge, so the card keeps its height: the file and
            // its length on top, the ranges to delete filling the rest.
            <div
              className={`trim-bento ${isDragActive ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="bento-tile trim-file">
                <MaterialIcon name="movie" size={20} className="text-accent shrink-0" />
                <p className="trim-file-name">
                  <FileName name={trimVideo.name} />
                </p>
                <button
                  type="button"
                  disabled={disabled || trimProbing}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-action"
                >
                  {t('trim.change')}
                </button>
              </div>
              <div className="bento-tile trim-length">
                <span className="trim-caption">{t('trim.lengthLabel')}</span>
                <span className="trim-length-value">
                  {trimProbing || trimDurationSec == null ? '…' : formatTimestamp(trimDurationSec)}
                </span>
              </div>
              <div className="bento-tile trim-ranges">
                <label htmlFor="trim-ranges" className="trim-caption">
                  {t('trim.rangesLabel')}
                </label>
                <textarea
                  id="trim-ranges"
                  value={rangeText}
                  aria-describedby="trim-ranges-hint"
                  aria-invalid={shownStatus.tone === 'error'}
                  disabled={disabled || trimProbing}
                  onChange={(e) => {
                    setRangeText(e.target.value);
                    setRangeErrorShown(false);
                    setError(null);
                  }}
                  onBlur={() => setRangeErrorShown(true)}
                  placeholder={
                    (trimDurationSec != null && placeholderRange(trimDurationSec)) ||
                    t('trim.rangesPlaceholder')
                  }
                  className="trim-input"
                />
                {trimDurationSec != null && trimDurationSec > 0 && (
                  // The whole video as a bar, with the sections that go marked;
                  // the summary line says the same in words.
                  <div className="trim-strip" aria-hidden="true">
                    {removedSections.map((section) => (
                      <span
                        key={`${section.startSec}-${section.endSec}`}
                        style={{
                          left: `${(section.startSec / trimDurationSec) * 100}%`,
                          width: `${((section.endSec - section.startSec) / trimDurationSec) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : mode === 'merge' && clips.length > 0 ? (
            // Bento tray in the drop zone's place, so the card keeps its height:
            // the lead clip gets a wide tile, then one tile per clip and an add
            // tile. Tiles rise in; the tray scrolls once it is full.
            <ul
              ref={clipListRef}
              aria-label={t('merge.clips')}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`merge-bento ${isDragActive ? 'is-dragging' : ''}`}
            >
              {clips.map((clip, index) => (
                <li
                  key={clip.id}
                  data-flip-id={clip.id}
                  tabIndex={-1}
                  aria-label={clip.file.name}
                  className={`bento-tile merge-tile ${index === 0 ? 'is-lead' : ''} ${clipHealth[clip.id] === 'bad' ? 'is-unreadable' : ''}`}
                  style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                >
                  <p className="merge-tile-name">
                    <span className="merge-tile-order">{String(index + 1).padStart(2, '0')}</span>
                    <FileName name={clip.file.name} />
                  </p>
                  <div className="merge-tile-foot">
                    <span className="merge-tile-size">
                      {clipHealth[clip.id] === 'bad'
                        ? t('merge.unreadable')
                        : clipHealth[clip.id] === 'checking'
                          ? t('merge.checking')
                          : formatBytes(clip.file.size, 1)}
                    </span>
                    <div className="merge-tile-controls">
                      <button
                        type="button"
                        data-control="earlier"
                        aria-label={t('a11y.moveEarlierClip', { name: clip.file.name })}
                        disabled={disabled || index === 0}
                        onClick={() => moveClip(index, -1)}
                        className="clip-control"
                      >
                        <MaterialIcon name="arrow_back" size={16} />
                      </button>
                      <button
                        type="button"
                        data-control="later"
                        aria-label={t('a11y.moveLaterClip', { name: clip.file.name })}
                        disabled={disabled || index === clips.length - 1}
                        onClick={() => moveClip(index, 1)}
                        className="clip-control"
                      >
                        <MaterialIcon name="arrow_forward" size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('a11y.removeClip', { name: clip.file.name })}
                        disabled={disabled}
                        onClick={() => removeClip(index)}
                        className="clip-control"
                      >
                        <MaterialIcon name="close" size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              <li data-flip-id="merge-add" className="bento-tile merge-tile-add">
                <button type="button" disabled={disabled} onClick={handleZoneClick}>
                  <MaterialIcon name="add" size={22} />
                  <span>{t('merge.addMore')}</span>
                </button>
              </li>
            </ul>
          ) : (
            <div className="drop-zone-wrap">
              <button
                type="button"
                disabled={disabled || checkingFile}
                aria-busy={checkingFile}
                data-ui="video-drop-zone"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleZoneClick}
                className={`drop-zone ${isDragActive ? 'is-dragging' : ''} ${error ? 'has-error' : ''}`}
              >
                <CompressOIcon name="addMedia" size={52} className="text-accent" />
                {/* Phones and tablets can't drop a file, so there the title
                    asks to choose one and the browse line goes. */}
                <span className="drop-zone-title drop-zone-title-pointer">
                  {t(`landing.drop.${mode}`)}
                </span>
                <span className="drop-zone-title drop-zone-title-touch">
                  {t(`landing.choose.${mode}`)}
                </span>
                <span className="drop-zone-browse">
                  {mode === 'merge' ? t('landing.browseMultiple') : t('landing.browseSingle')}
                </span>
                {/* The product's promise, on the first screen at every size:
                    the limit and that nothing is uploaded. */}
                <span className="drop-zone-promise">
                  <MaterialIcon name="lock" size={14} />
                  {t('landing.promise')}
                </span>
              </button>
              {error && (
                // Over the foot of the drop zone rather than below it, so the
                // card keeps its height and doesn't jump.
                <div className="inline-error is-floating" role="alert">
                  <PanelMascot variant="error" size="sm" className="shrink-0" />
                  <span className="text-left">{error}</span>
                </div>
              )}
            </div>
          )}

          {mode === 'trim' && trimVideo && (
            <div className="tray-footer">
              {/* With a tray open, errors take the status line's place, so
                  the card keeps its height. */}
              <p
                id="trim-ranges-hint"
                className={`tray-summary ${error ? 'is-error' : shownStatus.tone === 'hint' ? '' : `is-${shownStatus.tone}`}`}
              >
                {error ?? shownStatus.text}
              </p>
              <button
                type="button"
                disabled={disabled || trimProbing || trimDurationSec == null}
                onClick={handleTrim}
                className="pixel-btn"
              >
                {t('common.trimAndCompress')}
              </button>
            </div>
          )}

          {mode === 'merge' && clips.length > 0 && (
            <div className="tray-footer">
              <p aria-live="polite" className={`tray-summary ${error || unreadableClip ? 'is-error' : ''}`}>
                {error ??
                  (unreadableClip
                    ? t('errors.unreadableClip', { name: unreadableClip.file.name })
                    : // One clip can't be merged; the line says why Merge waits.
                      t(clips.length === 1 ? 'merge.needOneMore' : 'merge.summary', {
                        count: clips.length,
                        size: formatBytes(clips.reduce((sum, clip) => sum + clip.file.size, 0), 1),
                      }))}
              </p>
              <button
                type="button"
                disabled={disabled || !clipsReady}
                onClick={handleMerge}
                className="pixel-btn"
              >
                {t('common.merge')}
              </button>
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {trayNotice}
          </p>
        </div>
      </div>
    </section>
  );
}
