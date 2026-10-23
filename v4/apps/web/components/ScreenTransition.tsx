/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '@/lib/gsapSetup';
import { motion } from '@/lib/motion';

interface ScreenTransitionProps {
  screenKey: string;
  children: React.ReactNode;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// After a screen change, focus goes to the new screen's heading, so a keyboard
// or screen reader user lands on it (and hears it) instead of on <body>.
function focusHeading(el: HTMLElement | null) {
  el?.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus({ preventScroll: true });
}

export default function ScreenTransition({ screenKey, children, className = '' }: ScreenTransitionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isFirstMount = useRef(true);
  const [renderedKey, setRenderedKey] = useState(screenKey);
  const [rendered, setRendered] = useState(children);
  const shownKey = useRef(renderedKey);

  // Without a fade the new screen is visible at once; with one, the fade-in
  // below moves focus once it has finished, since a hidden heading can't take it.
  useEffect(() => {
    if (shownKey.current === renderedKey) return;
    shownKey.current = renderedKey;
    if (contentRef.current && getComputedStyle(contentRef.current).visibility !== 'hidden') {
      focusHeading(contentRef.current);
    }
  }, [renderedKey]);

  useLayoutEffect(() => {
    const el = contentRef.current;

    // Same step — update content silently (e.g. compression progress ticks).
    if (screenKey === renderedKey) {
      setRendered(children);
      return;
    }

    if (!el || prefersReducedMotion()) {
      setRendered(children);
      setRenderedKey(screenKey);
      isFirstMount.current = false;
      return;
    }

    if (isFirstMount.current) {
      isFirstMount.current = false;
      setRendered(children);
      setRenderedKey(screenKey);
      gsap.fromTo(
        el,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: motion.duration.stepIn, ease: 'power1.out' },
      );
      return;
    }

    gsap.killTweensOf(el);
    gsap.to(el, {
      autoAlpha: 0,
      duration: motion.duration.stepOut,
      ease: 'power1.in',
      onComplete: () => {
        setRendered(children);
        setRenderedKey(screenKey);
        requestAnimationFrame(() => {
          if (!contentRef.current) return;
          gsap.fromTo(
            contentRef.current,
            { autoAlpha: 0 },
            {
              autoAlpha: 1,
              duration: motion.duration.stepIn,
              ease: 'power1.out',
              onComplete: () => focusHeading(contentRef.current),
            },
          );
        });
      },
    });
  }, [screenKey, children, renderedKey]);

  return (
    <div className={`screen-content text-ink relative ${className}`}>
      <div ref={contentRef} className="w-full min-h-0 flex flex-col items-center my-auto py-2 sm:py-4">
        {rendered}
      </div>
    </div>
  );
}
