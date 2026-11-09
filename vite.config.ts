import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { parseDescribe } from './scripts/version.ts';
import { legalPages } from './scripts/legal-pages.ts';

function git(cmd: string, fallback = ''): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}
const versionInfo = parseDescribe(
  process.env.APP_DESCRIBE ?? git('describe --tags --long --always --match "v[0-9]*"', 'unknown'),
  Number(git('rev-list --count HEAD', '0'))
);

// GitHub Pages serves the app under /<repo>/. Override with BASE=/ for custom domains.
const base = process.env.BASE ?? '/structed/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(versionInfo) },
  plugins: [
    svelte(),
    legalPages(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'csl/*'],
      manifest: {
        name: 'Structed',
        short_name: 'Structed',
        description: 'Structure essays, theses and articles with sources, quotes and notes.',
        theme_color: '#1f2430',
        background_color: '#f7f6f3',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,csl,xml,docx}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // the word list for repairing PDF text is fetched only when needed, then kept offline
        runtimeCaching: [{ urlPattern: /\/dict\/[a-z-]+\.txt$/, handler: 'CacheFirst', options: { cacheName: 'dict' } }],
        navigateFallback: 'index.html',
        // the public pages must load as themselves, never be swapped for the app shell
        navigateFallbackDenylist: [/\/(about|privacy|terms)\.html$/]
      }
    })
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { app: 'index.html', about: 'about.html', privacy: 'privacy.html', terms: 'terms.html' }
    }
  }
});
