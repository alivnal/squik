/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface MaterialIconProps {
  name: string;
  className?: string;
  filled?: boolean;
  size?: number;
}

const ICON_PATHS: Record<string, string> = {
  add: 'M12 5v14M5 12h14',
  add_circle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-4H7v-2h4V7h2v4h4v2h-4v4Z',
  arrow_back: 'M19 12H5m0 0 6 6m-6-6 6-6',
  arrow_downward: 'M12 3v14m0 0 6-6m-6 6-6-6M5 21h14',
  arrow_forward: 'M5 12h14m0 0-6 6m6-6-6-6',
  arrow_upward: 'M12 21V7m0 0 6 6m-6-6-6 6M5 3h14',
  cancel: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 13.6L15.6 17 12 13.4 8.4 17 7 15.6l3.6-3.6L7 8.4 8.4 7 12 10.6 15.6 7 17 8.4 13.4 12l3.6 3.6Z',
  close: 'm18 6-12 12M6 6l12 12',
  dark_mode: 'M20.2 15.6A8.5 8.5 0 0 1 8.4 3.8 8.5 8.5 0 1 0 20.2 15.6Z',
  download: 'M12 3v12m0 0 5-5m-5 5-5-5M5 19h14',
  expand_more: 'm6 9 6 6 6-6',
  light_mode: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  folder_open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.4a2 2 0 0 0-1.9 1.4L3 19V7Zm0 12 2.5-7.6A2 2 0 0 1 7.4 10H21l-2.6 7.6a2 2 0 0 1-1.9 1.4H3Z',
  lock: 'M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Zm2 0V7a4 4 0 1 1 8 0v3m-4 4v2',
  movie: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 0 3 5m3-5 3 5m3-5 3 5M3 11h18',
  movie_filter: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 0 3 5m3-5 3 5m3-5 3 5M3 11h11',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4.1-3a8 8 0 0 1 13.2-2L20 12M4 12l1.9 5a8 8 0 0 0 13.2-2',
  timer: 'M10 2h4m-2 4v6l4 2m4-2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
};

export default function MaterialIcon({
  name,
  className = '',
  filled = false,
  size = 24,
}: MaterialIconProps) {
  const path = ICON_PATHS[name];
  if (!path) throw new Error(`Unsupported icon: ${name}`);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled && (name === 'movie' || name === 'add_circle') ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.5 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
