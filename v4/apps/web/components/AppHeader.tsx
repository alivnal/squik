/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { LanguagePicker } from '@squish/i18n/react';
import { useTheme } from '@/app/providers';
import MaterialIcon from './MaterialIcon';
import SquikLogo from './SquikLogo';

export default function AppHeader() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <header className="app-header" data-ui="app-header">
      <Link href="/" className="app-header-brand" aria-label={t('a11y.home')}>
        <SquikLogo />
      </Link>
      <div className="app-header-controls">
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          className="theme-toggle"
          aria-label={t(resolvedTheme === 'dark' ? 'a11y.lightMode' : 'a11y.darkMode')}
          title={t(resolvedTheme === 'dark' ? 'a11y.lightMode' : 'a11y.darkMode')}
        >
          <MaterialIcon name={resolvedTheme === 'dark' ? 'light_mode' : 'dark_mode'} size={18} />
        </button>
        <LanguagePicker className="app-site-footer-picker" />
      </div>
    </header>
  );
}
