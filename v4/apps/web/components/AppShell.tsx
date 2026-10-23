/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import AppFooter from './AppFooter';
import AppHeader from './AppHeader';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-canvas text-ink">
      <AppHeader />
      <main className="app-canvas flex-1">{children}</main>
      <AppFooter />
    </div>
  );
}
