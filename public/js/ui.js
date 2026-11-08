// DeepLine web — entry point
import { loadState, flushSave, get } from './state.js';
import { initSfx, unlockAudio } from './lib.js';
import { persistRequest } from './lib.js';
import { initRouter, mount } from './core.js';
import './home.js';
import './chat.js';
import './forms.js';
import { syncAutoPost } from './logic.js';

async function boot() {
  await loadState();
  initRouter();
  mount();
  syncAutoPost();
  persistRequest();
  initSfx();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('pagehide', () => { flushSave(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
}
boot().catch((e) => { document.body.textContent = '启动失败：' + (e && e.message); console.error(e); });
