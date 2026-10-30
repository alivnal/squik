/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialIcon from './MaterialIcon';

export default function AppFooter() {
  const { t } = useTranslation();

  return (
    <footer className="app-site-footer">
      <a
        className="app-site-footer-author"
        href="https://github.com/alivnal"
        target="_blank"
        rel="noopener noreferrer"
      >
        ali ünal
      </a>
      {/* Shown on every screen, a running job's too, where the promise matters most. */}
      <p className="app-site-footer-credit">
        <MaterialIcon name="lock" size={14} />
        {t('landing.privacyNote')}
      </p>
    </footer>
  );
}
