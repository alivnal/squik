import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export type MenuCommand = 'open-video';

/**
 * The standard menu bar: macOS's app menu bar, or on Windows File, Edit, View and
 * Help. The Windows window has no visible menu bar (its title bar is hidden), so
 * there the menu supplies the keyboard shortcuts: Ctrl+O, zoom, F11. Edit roles
 * are what make ⌘C/⌘V work in the trim ranges field; File ▸ Open Video… asks the
 * page to open its file picker.
 */
export function installApplicationMenu(window: () => BrowserWindow | null, isDevelopment: boolean): void {
  // Run as a user gesture: the page opens its file picker in response, and
  // Chromium only shows a picker for a gesture.
  const send = (command: MenuCommand) =>
    void window()?.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('squik:menu-command', { detail: '${command}' }))`,
      true,
    );
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Video…', accelerator: 'CmdOrCtrl+O', click: () => send('open-video') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDevelopment
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : []),
    {
      role: 'help',
      submenu: [
        { label: 'Squik on GitHub', click: () => void shell.openExternal('https://github.com/alivnal') },
        // macOS has About in the app menu.
        ...(isMac ? [] : ([{ type: 'separator' }, { role: 'about' }] as MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({
    applicationName: 'Squik',
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} Ali Unal`,
    credits: 'Made by Ali Unal · https://github.com/alivnal',
    authors: ['Ali Unal'],
    website: 'https://github.com/alivnal',
  });
}
