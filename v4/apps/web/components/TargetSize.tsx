/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MaterialIcon from './MaterialIcon';

export const DEFAULT_TARGET_MB = 200;

/**
 * The byte cap a job gets for a size in MB. The default keeps the engine's own
 * 200 MiB cap. Sizes people pick are usually a service's limit, so they count
 * in decimal MB, the smaller reading: 25 MB stays under 25,000,000 bytes and
 * under 25 MiB alike.
 */
export function capBytesFor(mb: number): number | undefined {
  return mb === DEFAULT_TARGET_MB ? undefined : mb * 1_000_000;
}
const PRESETS_MB = [10, 25, 50, 100, DEFAULT_TARGET_MB];
const MIN_TARGET_MB = 1;
const MAX_TARGET_MB = 4000;

/*
 * The slider runs on a log scale, so 1 to 50 MB, where most limits sit, gets
 * as much travel as 50 to 4000. It snaps to round sizes; the box beside it
 * takes any whole size.
 */
const SLIDER_STEPS = 1000;
const LOG_RANGE = Math.log(MAX_TARGET_MB / MIN_TARGET_MB);

function roundSize(mb: number): number {
  const step = mb < 100 ? 1 : mb < 1000 ? 5 : 50;
  return Math.min(MAX_TARGET_MB, Math.max(MIN_TARGET_MB, Math.round(mb / step) * step));
}

function sliderToMb(position: number): number {
  return roundSize(MIN_TARGET_MB * Math.exp((position / SLIDER_STEPS) * LOG_RANGE));
}

function mbToSlider(mb: number): number {
  const clamped = Math.min(MAX_TARGET_MB, Math.max(MIN_TARGET_MB, mb));
  return Math.round((Math.log(clamped / MIN_TARGET_MB) / LOG_RANGE) * SLIDER_STEPS);
}

interface TargetSizeProps {
  /** The size every job aims under, in MB. */
  valueMb: number;
  onChange: (mb: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The output size a job aims under: 200 MB unless the user locks another.
 * A small button that opens a panel over the card's lower part, so choosing
 * a size never changes the card's height.
 */
export default function TargetSize({ valueMb, onChange, disabled = false, className = '' }: TargetSizeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(valueMb));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) setDraft(String(valueMb));
  }, [open, valueMb]);

  // Escape or a click outside closes it; focus goes back to the button.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    // Focus the size in use: its preset, else the own-size box.
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('input'))?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const draftMb = Number(draft);
  const draftValid = Number.isInteger(draftMb) && draftMb >= MIN_TARGET_MB && draftMb <= MAX_TARGET_MB;
  const sliderPosition = mbToSlider(draftValid ? draftMb : valueMb);

  const choose = (mb: number) => {
    onChange(mb);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('target.buttonLabel', { size: valueMb })}
        onClick={() => setOpen((value) => !value)}
        className={`target-size-button ${valueMb !== DEFAULT_TARGET_MB ? 'is-custom' : ''} ${className}`}
      >
        {valueMb !== DEFAULT_TARGET_MB && <MaterialIcon name="lock" size={14} />}
        <span className="target-size-long">{t('target.under', { size: valueMb })}</span>
        <span className="target-size-short">{t('target.short', { size: valueMb })}</span>
        <MaterialIcon name="expand_more" size={14} />
      </button>

      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={`${panelId}-title`} className="target-size-panel">
          <div className="target-size-head">
            <p id={`${panelId}-title`} className="target-size-title">
              {t('target.title')}
            </p>
            <button
              type="button"
              className="clip-control"
              aria-label={t('a11y.close')}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <MaterialIcon name="close" size={16} />
            </button>
          </div>

          <div className="target-size-presets" role="group" aria-label={t('target.presets')}>
            {PRESETS_MB.map((mb) => (
              <button
                key={mb}
                type="button"
                aria-pressed={valueMb === mb}
                aria-label={t('target.short', { size: mb })}
                onClick={() => choose(mb)}
                className="target-size-preset"
              >
                {mb}
                <span className="target-size-preset-unit">{'\u00a0'}MB</span>
              </button>
            ))}
          </div>

          <form
            className="target-size-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftValid) choose(draftMb);
            }}
          >
            <label htmlFor={inputId} className="target-size-label">
              <MaterialIcon name="lock" size={14} />
              {t('target.custom')}
            </label>
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              step={1}
              value={sliderPosition}
              aria-label={t('target.slider')}
              aria-valuetext={t('target.short', { size: sliderToMb(sliderPosition) })}
              onChange={(e) => setDraft(String(sliderToMb(Number(e.target.value))))}
              style={{ '--fill': `${(sliderPosition / SLIDER_STEPS) * 100}%` } as React.CSSProperties}
              className="target-size-slider"
            />
            <div className="target-size-field">
              <input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={MIN_TARGET_MB}
                max={MAX_TARGET_MB}
                step={1}
                value={draft}
                aria-invalid={draft !== '' && !draftValid}
                onChange={(e) => setDraft(e.target.value)}
                className="target-size-input"
              />
              <span className="target-size-unit">MB</span>
              <button type="submit" disabled={!draftValid} className="pixel-btn pixel-btn-secondary">
                {t('target.apply')}
              </button>
            </div>
          </form>

          <p className="target-size-note">{t('target.note')}</p>
        </div>
      )}
    </>
  );
}
