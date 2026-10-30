# Native shells (Phase 9)

Web features stay in `src/`. Capacitor wraps the Vite `dist/` build for iPad and Android.

## One-time setup

```bash
npm install
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/app @capacitor/filesystem @capacitor/share
npm run build
npx cap add ios
npx cap add android
npx cap sync
```

This repo does **not** vendor `ios/` or `android/` trees. Add them locally once, then open:

```bash
npx cap add ios       # one-time, creates ios/
npx cap add android   # one-time, creates android/
npm run cap:sync
npm run cap:ios       # fails with instructions if ios/ is missing
npm run cap:android   # fails with instructions if android/ is missing
```

## OAuth

Add the Capacitor app URL schemes to Google Cloud **Authorized JavaScript origins** and redirect URIs, for example:

- `capacitor://localhost`
- `http://localhost` (Android cleartext debug)

Drive still uses `drive.file` via the same `VITE_GOOGLE_CLIENT_ID`.

## Stylus

Dispatch `pdf-notes-stylus` custom events from a Capacitor plugin or WKWebView bridge:

```js
window.dispatchEvent(
  new CustomEvent('pdf-notes-stylus', { detail: { action: 'toggle-eraser' } }),
)
```

`src/lib/native.ts` listens and App maps actions to tools.
