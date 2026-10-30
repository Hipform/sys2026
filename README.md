# PDF Notes

GoodNotes-style PWA: local PDF library, stylus inking, and optional Google Drive sync. Notes live in IndexedDB first; Drive is a copy of files this app creates.

## Features

- Document library (import / create / folders) with page covers
- Editor: floating toolbar, page thumbnails with ink, pen / highlighter / text / images
- Two-finger pan and pinch-zoom on a desk-style stage
- Undo / redo kept per page after refresh (IndexedDB)
- Vector PDF export (original page text kept; raster fallback if the PDF cannot be copied)
- Local JSON backup / restore
- Optional Google Drive sync (`drive.file` only)

## Try it

After push to `main`, GitHub Actions deploys the PWA to GitHub Pages:

`https://<github-user>.github.io/sys2026/`

Local:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173/

```bash
npm run build
npm run preview
```

For GitHub Pages builds, CI sets `VITE_BASE=/sys2026/`. Local default is `/`.

## Google Drive sync

Drive is optional. Without a client ID, the app stays on this device.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one).
2. Enable the **Google Drive API**.
3. Configure the **OAuth consent screen**. Add the scope `https://www.googleapis.com/auth/drive.file` (files this app creates, not the rest of Drive).
4. Create an **OAuth 2.0 Client ID** of type **Web application**.
5. Under **Authorized JavaScript origins**, add every origin you will open the app from, for example:
   - `http://127.0.0.1:5173`
   - `http://localhost:5173`
   - your production origin (`https://…`)
6. Copy the client ID (ends with `.apps.googleusercontent.com`). Do **not** put a client secret in this frontend.

Create `.env.local` in the project root:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Restart `npm run dev` after changing env files. Settings → Connect Google Drive. The app creates a `PDF Notes` folder; each notebook is a subfolder with `meta.json`, `document.pdf`, and `ink.json`.

Conflict rule: sync reads remote `meta.json` `contentUpdatedAt` and compares it to the local clock. The larger value wins. If Drive is newer, a dirty local copy is replaced and a toast says so.

Deleting a notebook writes a local tombstone and, on the next sync, moves the Drive folder to trash so the note does not come back.

JSON restore always allocates new notebook IDs. If Drive is connected, the next sync uploads those notes as separate folders rather than merging with older Drive copies.

Ink is stored in a fixed 820px-wide page layout so export and thumbnails match the editor on any screen size.

## More features (roadmap)

- Soft trash + restore, LWW overwrite revisions
- PDF text index / search, PDF highlight markups, bookmarks
- Single-notebook share package (`.pdfnotes.json`)
- Audio recording with stroke cues (Drive `audio.bin`)
- Layers (`layerId`), stickers, presentation fullscreen
- Infinite boards (`kind: 'board'`)
- Tags, favorites, dark theme, PIN session gate, flashcards MVP
- Capacitor native shell scaffold — see [`native/README.md`](native/README.md)

## Sync trust scripts

```bash
node scripts/verify-sync-lww.mjs
node scripts/verify-acton-hardening.mjs
node scripts/verify-sync-trust.mjs
node scripts/verify-ink-layout.mjs
```
