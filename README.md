# squik

Monorepo for browser and desktop video compression under 200 MB.

## Structure

```
v3/
├── apps/web/          # Next.js browser app (v3) — FFmpeg.wasm, port 3001
├── apps/desktop/      # Electron desktop app — native FFmpeg
├── packages/          # Package stubs (squish-core, i18n) for workspace resolution
└── scripts/           # Dev helpers (sync-squish-core, kill-port, fix-electron)

v4/
└── apps/web/          # Next.js browser app (v4) — trim support, port 3002
```

**v4 owns its shared code** in `v4/apps/web/lib/squish-core/` and `v4/apps/web/lib/i18n/`; nothing
syncs into these folders. The v3 web app keeps its own older copies in `v3/apps/web/lib/`.

## Quick start

```bash
npm install

# v3 web app  → http://localhost:3001
npm run dev:web

# v4 web app  → http://localhost:3002
npm run dev:web:v4

# Electron desktop
npm run dev
```

## Desktop builds

The desktop app renders the v4 web UI (`v4/apps/web`) as is, so web UI changes ship to
desktop on the next build. Only the compression layer differs: Vite swaps
`lib/compress-wasm` for `v3/apps/desktop/src/native-compress.ts`, which runs compress,
merge and trim jobs with native FFmpeg/ffprobe binaries in the Electron main process.
Each macOS build bundles the FFmpeg binaries for its target architecture, and both
architectures can be built from either kind of Mac. The Windows build also runs on a
Mac (no Wine needed): it fetches the Windows FFmpeg binaries pinned in
`package-lock.json` into `build-resources/bin/win32-x64/`.

```bash
# Apple Silicon (arm64)
npm run dist:mac:arm64

# Intel Mac (x64)
npm run dist:mac:x64

# Windows x64: NSIS installer and portable .exe
npm run dist:win

# Windows x64 portable .exe only
npm run dist:portable
```

The macOS packages are signed with the Developer ID certificate named in `build.mac.identity`
(hardened runtime) and notarized by Apple, so they open on any Mac like an App Store app.
The build Mac needs that certificate in its login keychain and a notarytool profile named
`squik-notary`, saved once with:

```bash
xcrun notarytool store-credentials squik-notary --apple-id "<Apple ID>" --team-id "<Team ID>"
```

The Windows executables are unsigned, so SmartScreen asks users to choose More info >
Run anyway. Configure Windows code signing before distributing broadly.

The **Windows desktop** workflow (`.github/workflows/windows-desktop.yml`) builds the
Windows app on a Windows runner, installs it silently, and drives it with
`v3/apps/desktop/scripts/windows-smoke.mjs`: window chrome, menu, and compress, merge
and trim jobs on paths with spaces, Turkish letters and a UNC share. Run it from the
Actions tab.

## Build & deploy

```bash
# Production web builds
npm run build:web        # v3
npm run build:web:v4     # v4

# Desktop portable/installer
npm run dist
```

**Vercel:** configure the project in **Settings → Build and Deployment**:

- Set **Root Directory** to `v4/apps/web`.
- Enable **Include source files outside the Root Directory** so the npm workspace can resolve
  `@squish/i18n` from `v3/packages/i18n`.
- Keep **Framework Preset** set to **Next.js** and use the app's `vercel.json` settings.
- After changing the Root Directory, redeploy once with **Clear build cache** enabled.

Do not use the repository root as the Vercel Root Directory. The root `vercel.json` invokes the
V4 workspace build, which writes the routes manifest to `v4/apps/web/.next`; when Vercel treats
the repository root as the Next.js project, it instead looks for `.next/routes-manifest.json` at
the repository root and fails with `NEXT_NO_ROUTES_MANIFEST`.

## Notes

- Legacy pre-v3 files are documented in [LEGACY.md](LEGACY.md).
- When modifying shared types/functions (squish-core, i18n), edit the **v4 source** (`v4/apps/web/lib/`).
