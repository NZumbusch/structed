import './app.css';
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { db } from './lib/db.svelte';
import { applySettings } from './lib/settings.svelte';
import { sync } from './lib/sync.svelte';
import { ui } from './lib/ui.svelte';
import { t } from './lib/i18n';

applySettings();
db.init().then(() => sync.start());

const app = mount(App, { target: document.getElementById('app')! });

const update = registerSW({
  onNeedRefresh() {
    ui.toast(t('A new version is available.'), { action: { label: t('Reload'), run: () => update(true) } }, 60_000);
  },
  onOfflineReady() {
    ui.toast(t('Ready to work offline.'), { kind: 'ok' });
  }
});

export default app;
