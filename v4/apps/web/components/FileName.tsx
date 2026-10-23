/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// Characters of the name kept, besides the extension, when it is cut short.
const KEPT_TAIL = 4;

/**
 * A file name that loses its middle, not its end, when it runs out of room:
 * "İstanbul-boğ…tımı.mov". The extension and the last few characters are what
 * tell two clips apart. The full name is in the title.
 */
export default function FileName({ name, className = '' }: { name: string; className?: string }) {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.length - dot : 0;
  const split = Math.max(0, name.length - extension - KEPT_TAIL);

  return (
    <span className={`file-name ${className}`.trim()} title={name}>
      <span className="file-name-head">{name.slice(0, split)}</span>
      <span className="file-name-tail">{name.slice(split)}</span>
    </span>
  );
}
