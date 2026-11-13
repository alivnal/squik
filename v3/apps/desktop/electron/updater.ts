import { app, dialog, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

/** How often a running app looks for a new release after the check at launch. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Keeps the installed app current from the GitHub releases of alivnal/squik:
 * a new version downloads in the background, then the user is asked to restart,
 * or it installs on the next quit. Never while a job runs, and not at all in
 * development or the portable Windows build, which cannot replace itself.
 */
export function startAutoUpdates(window: () => BrowserWindow | null, jobRunning: () => boolean): void {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Offline or a release still uploading: try again at the next check, quietly.
  autoUpdater.on('error', (error) => console.warn('[Squik] Update check failed:', error.message));

  let asked = false;
  autoUpdater.on('update-downloaded', (info) => {
    if (asked) return;
    const ask = () => {
      // Restarting would cancel a running encode; ask once the job is done.
      if (jobRunning()) {
        setTimeout(ask, 30_000).unref();
        return;
      }
      asked = true;
      const turkish = app.getLocale().startsWith('tr');
      const options = {
        type: 'info' as const,
        buttons: turkish ? ['Şimdi yeniden başlat', 'Sonra'] : ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: turkish ? `Squik ${info.version} hazır` : `Squik ${info.version} is ready`,
        detail: turkish
          ? 'Yeni sürüm indirildi. Şimdi yeniden başlatabilir ya da bir dahaki kapanışta kurulmasını bekleyebilirsin.'
          : 'The new version has downloaded. Restart now, or it installs the next time you quit.',
      };
      const parent = window();
      const shown = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
      void shown.then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    };
    ask();
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}
