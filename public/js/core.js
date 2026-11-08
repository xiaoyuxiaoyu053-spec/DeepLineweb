// DeepLine web — router, theme, and shared UI primitives.
import { h, $, luminanceOf } from './lib.js';
import { icon } from './icons.js';
import { S, get, on, mediaUrl, personas } from './state.js';

export const nav = { page: 'home', tab: 'chat', id: '', edit: false, search: '', mode: '私聊' };
const views = {};
export function registerView(name, fn) { views[name] = fn; }
let current = null;

export function mount() {
  const phone = $('#phone');
  const builder = views[nav.page] || views.home;
  current = builder();
  phone.replaceChildren(current.el);
  applyTheme();
  if (current.afterMount) current.afterMount();
}
export function go(page, params = {}, push = true) {
  Object.assign(nav, { page }, params);
  if (push) history.pushState({ depth: (history.state && history.state.depth || 0) + 1, page: nav.page, tab: nav.tab, id: nav.id }, '');
  mount();
}
export function goBack() {
  if (history.state && history.state.depth > 0) history.back();
  else { nav.page = 'home'; mount(); }
}
export function initRouter() {
  history.replaceState({ depth: 0, page: 'home', tab: nav.tab, id: '' }, '');
  window.addEventListener('popstate', (e) => {
    const st = e.state || { page: 'home' };
    closeOverlays();
    nav.page = st.page || 'home'; if (st.tab && !nav.keepTab) nav.tab = st.tab; nav.keepTab = false; nav.id = st.id || '';
    mount();
  });
  on('data', () => { if (current && current.update) current.update(); applyTheme(); });
  on('busy', () => { if (current && current.onBusy) current.onBusy(); });
  on('error', () => { if (current && current.onError) current.onError(); });
  on('toast', showToast);
}
export const currentView = () => current;

// ───────────── theme ─────────────
let lumCache = { src: '', lum: 0.85 };
function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [10, 132, 255]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export const mix = (hex, to, f) => { const a = hexToRgb(hex), b = hexToRgb(to); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join(''); };
export function wallDark() {
  const bg = mediaUrl(get('background'));
  if (!bg) return false;
  if (lumCache.src !== bg) { lumCache = { src: bg, lum: 0.85 }; luminanceOf(bg).then((l) => { lumCache = { src: bg, lum: l }; applyTheme(); }); }
  const dim = get('backgroundAlpha');
  return lumCache.lum * (1 - dim) + 0.85 * dim < 0.5;
}
export function chatDark() { const t = get('chatTheme'); return t === '深色' ? true : t === '浅色' ? false : wallDark(); }
export function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--accent', get('theme'));
  const dark = wallDark();
  root.style.setProperty('--g', get('glassUi') ? String(dark ? Math.max(0.55, get('glassOpacity')) : get('glassOpacity')) : '.95');
  document.body.classList.toggle('wall-dark', dark);
  const wall = $('#wall');
  wall.classList.toggle('dark', dark && !mediaUrl(get('background')));
  const photo = $('.photo', wall), bg = mediaUrl(get('background'));
  if (bg) { photo.hidden = false; photo.style.backgroundImage = `url("${bg}")`; photo.style.opacity = String(Math.max(0.15, 1 - get('backgroundAlpha'))); photo.style.filter = get('backgroundBlur') ? `blur(${get('backgroundBlur')}px)` : ''; photo.style.transform = get('backgroundBlur') ? 'scale(1.06)' : ''; }
  else { photo.hidden = true; }
  const cs = $('.caustics', wall); if (cs) cs.hidden = !!bg;
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = dark ? '#111' : '#e9edf2';
}

// ───────────── building blocks ─────────────
export function avatarEl(ref, name, size, extra = '') {
  const url = mediaUrl(ref);
  const el = h('div', { class: 'avatar ' + (url ? '' : 'ph ') + extra, style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' } });
  if (url) el.style.backgroundImage = `url("${url}")`; else el.textContent = (name || '?').slice(0, 1);
  return el;
}
export function badge(n) { return h('span', { class: 'badge' }, n > 99 ? '99+' : String(n)); }
export function glassBtn(iconName, onClick, cls = '', size = 21) { return h('button', { class: 'circle-btn glass s2 bounce ' + cls, onClick }, icon(iconName, size)); }
export function btn(label, onClick, kind = '', iconName = '') { return h('button', { class: 'btn bounce soft ' + kind, onClick }, iconName ? icon(iconName, 19) : null, label); }
export function emptyState(title, sub) { return h('div', { class: 'empty pop-in' }, h('div', { class: 'ic glass s2' }, icon('chat', 36)), h('b', null, title), h('span', null, sub)); }
export function field(label, el) { return h('label', { class: 'fld' }, h('span', null, label), el); }
export function switchEl(on, onChange) {
  const el = h('button', { class: 'switch bounce' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) });
  el.addEventListener('click', () => { const v = !el.classList.contains('on'); el.classList.toggle('on', v); el.setAttribute('aria-checked', String(v)); onChange(v); });
  return el;
}
export function setting(title, sub, on, onChange) {
  return h('div', { class: 'setting' }, h('div', { class: 't' }, h('b', null, title), sub ? h('small', null, sub) : null), switchEl(on, onChange));
}
export function chips(options, selected, onPick) {
  const wrap = h('div', { class: 'chips' });
  const draw = (sel) => { wrap.replaceChildren(...options.map((o) => h('button', { class: 'ch bounce' + (o === sel ? ' on' : ''), onClick: () => { onPick(o); draw(o); } }, o))); };
  draw(selected);
  return wrap;
}

/** tap + long-press (touch hold, mouse hold, or right-click) */
export function press(el, { onTap, onLong }) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    sx = e.clientX; sy = e.clientY; fired = false;
    timer = setTimeout(() => { fired = true; timer = null; if (onLong) onLong(e); }, 450);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) clear(); });
  el.addEventListener('pointerup', () => { if (timer) { clear(); if (onTap) onTap(); } });
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); clear(); if (onLong && !fired) onLong(e); });
}

// ───────────── overlays ─────────────
let overlays = [];
export function closeOverlays() { overlays.forEach((o) => o.remove()); overlays = []; }
function track(el) { overlays.push(el); document.body.append(el); return el; }
export function addOverlay(el) { track(el); return () => { el.remove(); overlays = overlays.filter((o) => o !== el); }; }
export function modal({ title, body, actions = [], onClose }) {
  const close = () => { back.remove(); overlays = overlays.filter((o) => o !== back); if (onClose) onClose(); };
  const bar = h('div', { class: 'bar' }, actions.map((a) => h('button', { class: a.kind || '', onClick: async () => { if (a.onClick) { const r = await a.onClick(); if (r === false) return; } close(); } }, a.label)));
  const box = h('div', { class: 'modal' }, title ? h('h3', null, title) : null, ...(Array.isArray(body) ? body : [body]), actions.length ? bar : null);
  const back = h('div', { class: 'modal-back', onPointerdown: (e) => { if (e.target === back) close(); } }, box);
  track(back);
  return { close, box };
}
export function confirmDialog(title, text, okLabel, danger = true) {
  return new Promise((res) => { let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    modal({ title, body: h('p', null, text), actions: [{ label: '取消', onClick: () => fin(false) }, { label: okLabel, kind: danger ? 'd' : 'p', onClick: () => fin(true) }], onClose: () => fin(false) }); });
}
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu' }, items.map((i) => h('button', { class: i.danger ? 'del' : '', onClick: () => { m.remove(); i.onClick(); } }, i.label)));
  m.style.top = Math.min(window.innerHeight - 60 - items.length * 46, r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - 210, r.left)) + 'px';
  document.body.append(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}
let toastEl = null, toastTimer = null;
export function showToast(text) {
  if (!text) return;
  toastEl && toastEl.remove();
  toastEl = h('div', { class: 'toast glass s3', onClick: () => toastEl && toastEl.remove() }, text);
  document.body.append(toastEl);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl && toastEl.remove(), 4200);
}
export function pickFile(accept, onFile) {
  const input = h('input', { type: 'file', accept, style: 'display:none' });
  input.addEventListener('change', () => { if (input.files && input.files[0]) onFile(input.files[0]); input.remove(); });
  document.body.append(input); input.click();
}
export const totalUnread = () => personas().reduce((n, p) => n + unreadOf(p), 0);
export const unreadOf = (p) => (p.messages || []).filter((m) => m.role === 'assistant' && 'read' in m && m.read === false && m.content !== '---').length;
export function previewOf(msgs) {
  for (let i = (msgs || []).length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.content === '---' || m.type === 'summary') continue;
    const c = m.content || '';
    let t;
    if (m.type === 'payment') t = (m.paymentType === 'redpacket' ? '[红包] ¥' : '[转账] ¥') + m.amount;
    else if (c.includes('[[IMAGE:')) t = '[图片] ' + c.split('[[IMAGE:')[0].trim();
    else if (c.includes('[[GIF:')) t = '[动图]';
    else t = c.replace(/\n/g, ' ');
    t = t.trim();
    return { text: m.speakerName && m.role === 'assistant' ? m.speakerName + '：' + t : t, time: m.time || 0 };
  }
  return { text: '', time: 0 };
}
