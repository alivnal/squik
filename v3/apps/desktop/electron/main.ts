import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, shell } from 'electron';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, rmSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { CompressionCancelledError } from '../../../../v4/apps/web/lib/squish-core';
import { FfmpegJobs, type JobOutput } from './jobs';
import type { NativeJob, NativeJobResult } from './contracts';
import { installApplicationMenu } from './menu';
import { shareableCopy, shareFile } from './share';
import { rememberWindowBounds, restoreWindowGeometry } from './window-state';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const rendererDirectory = join(currentDirectory, '../dist');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// The renderer is served from squik://app/ rather than file:// so the web app's
// root-relative asset paths (/hero/…, /icon.svg) resolve, and finished videos
// are served from the same origin so the web UI's download link works as is.
const SCHEME = 'squik';
const ORIGIN = `${SCHEME}://app`;
const OUTPUT_PREFIX = '/__output/';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // The React refresh preamble is an inline script in development.
  devServerUrl ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  devServerUrl ? "connect-src 'self' ws://localhost:3000" : "connect-src 'self'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
const outputs = new Map<string, JobOutput>();
/** Where the user saved results; only these may be revealed in Finder. */
const savedPaths = new Set<string>();
const jobs = new FfmpegJobs(getBinaryPath);

// Packaged apps carry FFmpeg in Resources/bin; development uses the same binaries
// that scripts/copy-native-binaries.mjs prepares (made executable) for packaging,
// with Windows .exe files in their own bin/win32-<arch> folder.
function getBinaryPath(name: 'ffmpeg' | 'ffprobe'): string {
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? `${name}.exe` : name;
  const directory = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(currentDirectory, '../build-resources/bin', isWindows ? `win32-${process.arch}` : '');
  const path = join(directory, binaryName);
  if (!existsSync(path)) throw new Error(`The ${name} binary is missing from ${directory}.`);
  return path;
}

// Every running app (an installed copy next to a dev build, or two users on
// one Mac) keeps its encodes in its own folder named after its process, so
// one starting or quitting never deletes another's job in progress. Squik
// 4.0.1 and earlier wiped a shared squik-output folder; this one is apart.
const WORK_ROOT = 'squik-work';

function outputDirectory(): string {
  return join(app.getPath('temp'), WORK_ROOT, `${process.pid}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Folders left behind by apps that crashed or were forced to quit. */
async function removeAbandonedOutputs(): Promise<void> {
  const root = join(app.getPath('temp'), WORK_ROOT);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && Number(entry.name) !== process.pid && !isRunning(Number(entry.name)))
    .map((entry) => rm(join(root, entry.name), { recursive: true, force: true })));
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted application window.');
  }
}

/** Paths come from files the user picked or dropped; accept only existing local files. */
async function assertVideoPath(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Invalid video path.');
  const stats = await stat(path).catch(() => null);
  if (!stats?.isFile()) throw new Error('The selected video could not be found.');
  return path;
}

/** A size cap from the page: a positive finite byte count, or none (the default cap). */
function assertMaxOutputBytes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid size limit.');
  }
  return value;
}

async function assertJob(job: unknown): Promise<NativeJob> {
  const value = job as Partial<NativeJob> | null;
  const maxOutputBytes = assertMaxOutputBytes(value?.maxOutputBytes);
  if (value?.kind === 'compress') return { kind: 'compress', path: await assertVideoPath(value.path), maxOutputBytes };
  if (value?.kind === 'merge' && Array.isArray(value.paths)) {
    return { kind: 'merge', paths: await Promise.all(value.paths.map(assertVideoPath)), maxOutputBytes };
  }
  if (value?.kind === 'trim' && Array.isArray(value.deleteSegments)) {
    const deleteSegments = value.deleteSegments.map((segment) => ({
      startSec: Number(segment?.startSec),
      endSec: Number(segment?.endSec),
    }));
    if (deleteSegments.some((segment) => !Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec))) {
      throw new Error('Invalid trim ranges.');
    }
    return { kind: 'trim', path: await assertVideoPath(value.path), deleteSegments, maxOutputBytes };
  }
  throw new Error('Invalid job.');
}

/** Only the latest result is offered for download; earlier encodes are removed. */
async function clearOutputs(): Promise<void> {
  // A result that needed no encode points at the user's own file; never delete that.
  const temporary = [...outputs.values()].filter((output) => dirname(output.path) === outputDirectory());
  outputs.clear();
  await Promise.all([
    ...temporary.map((output) => rm(output.path, { force: true })),
    rm(join(outputDirectory(), 'share'), { recursive: true, force: true }),
  ]);
}

/** A short system sound when a job ends, so a long encode can run in the background. */
function playFinishSound(succeeded: boolean): void {
  if (process.platform !== 'darwin') {
    shell.beep();
    return;
  }
  const sound = succeeded ? 'Glass' : 'Basso';
  spawn('afplay', [`/System/Library/Sounds/${sound}.aiff`]).on('error', () => shell.beep());
}

async function runJob(jobId: string, job: NativeJob): Promise<NativeJobResult> {
  await clearOutputs();
  await mkdir(outputDirectory(), { recursive: true });
  const started = Date.now();
  // Long encodes keep running when the Mac would otherwise idle-sleep.
  const blocker = powerSaveBlocker.start('prevent-app-suspension');
  let output: JobOutput;
  try {
    output = await jobs.run(job, join(outputDirectory(), `${jobId}.mp4`), (progress) => {
      mainWindow?.webContents.send('video:progress', { jobId, ...progress });
      // The same progress on the Dock icon, for when the window is behind others.
      if (progress.stage === 'encoding') {
        mainWindow?.setProgressBar(progress.ratio);
      }
    });
  } catch (error) {
    if (!(error instanceof CompressionCancelledError)) playFinishSound(false);
    throw error;
  } finally {
    powerSaveBlocker.stop(blocker);
    mainWindow?.setProgressBar(-1);
  }
  outputs.set(jobId, output);
  playFinishSound(true);
  if (mainWindow && !mainWindow.isFocused()) app.dock?.bounce('informational');
  return {
    originalSize: output.originalSize,
    compressedSize: output.compressedSize,
    filename: output.filename,
    outputUrl: `${ORIGIN}${OUTPUT_PREFIX}${jobId}/${encodeURIComponent(output.filename)}`,
    skippedEncode: output.skippedEncode,
    encodeTimeMs: output.encodeTimeMs,
    totalTimeMs: Date.now() - started,
    clipCount: output.clipCount,
    trimSegmentCount: output.trimSegmentCount,
  };
}

async function handleAppRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response(null, { status: 404 });
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith(OUTPUT_PREFIX)) {
    const output = outputs.get(pathname.slice(OUTPUT_PREFIX.length).split('/')[0]);
    if (!output) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(output.path).toString());
  }

  let response: Response;
  if (devServerUrl) {
    response = await net.fetch(new URL(`${url.pathname}${url.search}`, devServerUrl).toString());
  } else {
    const filePath = resolve(rendererDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
    const inside = relative(rendererDirectory, filePath);
    if (inside.startsWith('..') || isAbsolute(inside)) return new Response(null, { status: 404 });
    response = await net.fetch(pathToFileURL(filePath).toString());
  }

  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  return new Response(response.body, { status: response.status, headers });
}

function createWindow(): void {
  // Windows draws its caption buttons over the page header, in the page's colours.
  const titleBarOverlay = (): Electron.TitleBarOverlay => nativeTheme.shouldUseDarkColors
    ? { color: '#0f0f11', symbolColor: '#f4f4f5', height: 40 }
    : { color: '#f9fafb', symbolColor: '#18181b', height: 40 };
  // Content runs under the title bar and the page header is the drag area: on
  // macOS the traffic lights sit centred in it, on Windows the caption buttons
  // sit at its top right.
  const chrome: Electron.BrowserWindowConstructorOptions =
    process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 38 } }
    : process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }
    : {};

  mainWindow = new BrowserWindow({
    ...restoreWindowGeometry(),
    ...chrome,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0f' : '#f9fafb',
    show: false,
    title: 'Squik',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });

  const window = mainWindow;
  rememberWindowBounds(window);
  window.once('ready-to-show', () => window.show());
  const sendFullScreen = () => window.webContents.send('window:fullscreen', window.isFullScreen());
  window.on('enter-full-screen', sendFullScreen);
  window.on('leave-full-screen', sendFullScreen);
  if (process.platform === 'win32') {
    // theme:set and system theme changes both land here.
    const updateTitleBarOverlay = () => window.setTitleBarOverlay(titleBarOverlay());
    nativeTheme.on('updated', updateTitleBarOverlay);
    window.once('closed', () => nativeTheme.off('updated', updateTitleBarOverlay));
  }

  void window.loadURL(`${ORIGIN}/`);
  mainWindow.on('closed', () => {
    mainWindow = null;
    jobs.cancel();
  });
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, handleAppRequest);
  void removeAbandonedOutputs();

  ipcMain.handle('video:probe', async (event, path: unknown) => {
    assertTrustedSender(event);
    const { name, size, duration, width, height } = await jobs.probe(await assertVideoPath(path));
    return { name, size, duration, width, height };
  });

  ipcMain.handle('video:run-job', async (event, jobId: unknown, job: unknown) => {
    assertTrustedSender(event);
    if (typeof jobId !== 'string' || !/^[\w-]{1,64}$/.test(jobId)) throw new Error('Invalid job id.');
    return runJob(jobId, await assertJob(job));
  });

  ipcMain.handle('video:cancel', (event) => {
    assertTrustedSender(event);
    jobs.cancel();
  });

  /** The finished job behind a result URL the page was given. */
  const outputForUrl = (outputUrl: unknown): { jobId: string; output: JobOutput } => {
    if (typeof outputUrl !== 'string' || !outputUrl.startsWith(`${ORIGIN}${OUTPUT_PREFIX}`)) {
      throw new Error('Unknown result.');
    }
    const jobId = outputUrl.slice(`${ORIGIN}${OUTPUT_PREFIX}`.length).split('/')[0];
    const output = outputs.get(jobId);
    if (!output) throw new Error('This result is no longer available. Run the job again.');
    return { jobId, output };
  };

  // The result screen asks where to keep the file as soon as a job ends: a Save
  // sheet in Downloads, then the page offers Show in Finder for the saved copy.
  ipcMain.handle('output:save', async (event, outputUrl: unknown) => {
    assertTrustedSender(event);
    const { output } = outputForUrl(outputUrl);
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: join(app.getPath('downloads'), output.filename),
      filters: [{ name: 'Video', extensions: [extname(output.filename).slice(1) || 'mp4'] }],
    });
    if (canceled || !filePath) return null;
    // A result that needed no encode is the user's own file; saving it over itself is a no-op.
    if (resolve(filePath) !== resolve(output.path)) await copyFile(output.path, filePath);
    savedPaths.add(filePath);
    app.dock?.downloadFinished(filePath);
    return filePath;
  });

  ipcMain.handle('output:share', async (event, outputUrl: unknown, target: unknown) => {
    assertTrustedSender(event);
    if (target !== 'drive' && target !== 'mail' && target !== 'slack' && target !== 'more') {
      throw new Error('Unknown share target.');
    }
    const { jobId, output } = outputForUrl(outputUrl);
    const file = await shareableCopy(output.path, output.filename, join(outputDirectory(), 'share', jobId));
    return shareFile(file, output.filename, target, mainWindow);
  });

  ipcMain.handle('output:reveal', (event, path: unknown) => {
    assertTrustedSender(event);
    if (typeof path !== 'string' || !savedPaths.has(path)) throw new Error('Unknown saved file.');
    shell.showItemInFolder(path);
  });

  // Keep native dialogs and menus in the page's light or dark theme.
  ipcMain.handle('theme:set', (event, theme: unknown) => {
    assertTrustedSender(event);
    if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme;
  });

  installApplicationMenu(() => mainWindow, Boolean(devServerUrl));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Synchronous: the process exits right after this, before an async delete would finish.
  rmSync(outputDirectory(), { recursive: true, force: true });
});
