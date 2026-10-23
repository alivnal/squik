/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import AppFooter from './AppFooter';
import AppHeader from './AppHeader';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-canvas text-ink">
      {/* First stop for the keyboard: past the logo, theme and language. */}
      <a href="#main" className="skip-link">
        {t('a11y.skipToTool')}
      </a>
      <AppHeader />
      <main id="main" tabIndex={-1} className="app-canvas flex-1">{children}</main>
      <AppFooter />
    </div>
  );
}
