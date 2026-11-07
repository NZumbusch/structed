import './app.css';
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { db } from './lib/db.svelte';
import { applySettings, settings } from './lib/settings.svelte';
import { alignIcons } from './lib/iconAlign';
import { createDemo } from './lib/demo';
import { sync } from './lib/sync.svelte';
import { startZoteroSync, zsync } from './lib/zoterosync.svelte';
import { startBackHandling } from './lib/back.svelte';
import { ui } from './lib/ui.svelte';
import { t } from './lib/i18n';

applySettings();
alignIcons();

// Handle for end-to-end tests and debugging from the console.
(window as unknown as { __structed: unknown }).__structed = { db, ui, settings, createDemo, zsync };
db.init().then(() => {
  sync.start();
  startZoteroSync();
  startBackHandling();
});

const app = mount(App, { target: document.getElementById('app')! });

const update = registerSW({
  onNeedRefresh() {
    ui.toast(t('A new version is available.'), { action: { label: t('Reload'), run: () => update(true) } }, 60_000);
  },
  onOfflineReady() {
    // shown in Settings → About instead of a toast on every first start
    ui.offlineReady = true;
  }
});

export default app;
