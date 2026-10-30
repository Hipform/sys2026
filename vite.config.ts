import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Project Pages base (`/repo/`). Override with VITE_BASE for custom hosts. */
const base = process.env.VITE_BASE ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'pdf.worker.min.mjs',
        'pdfjs/cmaps/**',
        'pdfjs/standard_fonts/**',
      ],
      manifest: {
        name: 'PDF Notes',
        short_name: 'PDF Notes',
        description: 'PDF note-taking with stylus inking for iPad',
        theme_color: '#eef1f5',
        background_color: '#eef1f5',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,svg,woff2,bcmap,pfb}'],
        // PDF.js worker / cmaps can be large; keep them in the precache shell
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  optimizeDeps: {
    // Prevent Vite from prebundling the worker into a broken CJS fake-worker.
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
})
