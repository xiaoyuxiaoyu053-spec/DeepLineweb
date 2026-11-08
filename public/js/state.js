// DeepLine web — application state (same JSON shape as the Android app, so backups are interchangeable).
import { dbGet, dbSet, dbAllMedia, uid, readFileAsDataUrl, prepareImage, makeZip, readZip, dataUrlToBytes, bytesToDataUrl, mimeFromName, download, setMediaResolver } from './lib.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export const S = { data: null, media: new Map(), busy: false, error: '', toastText: '' };

const DEFAULTS = {
  personas: [], posts: [], groups: [], theme: '#0A84FF', myName: '我', myBio: '', myAvatar: '', momentsCover: '', background: '',
  backgroundAlpha: 0.0, backgroundBlur: 0, glassUi: true, glassOpacity: 0.34, soundEnabled: true, deepThinkingEnabled: false,
  conversationSummaryEnabled: false, autoAiEnabled: false, aiMomentsEnabled: true, multiReplyEnabled: false, multiReplyCount: 2,
  memoryLimit: 30, bubbleColor: '#FFFFFF', myBubbleColor: '#0A84FF', chatTheme: '自动', appTitle: '信息', inputHint: 'iMessage信息',
  aiTextColor: '#263247', myTextColor: '#243047', directMode: false, bubbleBackground: '',
};

export async function loadState() {
  const stored = await dbGet('kv', 'data');
  S.data = Object.assign({}, structuredClone(DEFAULTS), stored || {});
  for (const k of ['personas', 'posts', 'groups']) if (!Array.isArray(S.data[k])) S.data[k] = [];
  S.media = await dbAllMedia();
  setMediaResolver(mediaUrl);
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => dbSet('kv', 'data', JSON.parse(JSON.stringify(S.data))).catch(() => toast('保存失败：浏览器存储空间不足？')), 350);
}
export function flushSave() { clearTimeout(saveTimer); return dbSet('kv', 'data', JSON.parse(JSON.stringify(S.data))); }
/** Call after any change to the data object: persists and tells the UI to refresh. */
export function touch() { save(); emit('data'); }

export const get = (k) => (S.data[k] === undefined ? DEFAULTS[k] : S.data[k]);
export function set(k, v) { S.data[k] = v; touch(); }
export const personas = () => S.data.personas;
export const groups = () => S.data.groups;
export const posts = () => S.data.posts;
export const findPersona = (id) => S.data.personas.find((p) => p.id === id) || null;
export const findGroup = (id) => S.data.groups.find((g) => g.id === id) || null;
export const findPost = (id) => S.data.posts.find((p) => p.id === id) || null;
export const sound = () => !!get('soundEnabled');

export function setBusy(b) { S.busy = b; emit('busy'); }
export function setError(e) { S.error = e || ''; emit('error'); }
export function toast(text) { S.toastText = text; emit('toast', text); }

// ───────────── media ─────────────
export async function addMediaFromFile(file, maxEdge = 1280) {
  const dataUrl = await prepareImage(file, maxEdge);
  return addMediaDataUrl(dataUrl);
}
export async function addMediaDataUrl(dataUrl) {
  const id = uid();
  S.media.set(id, dataUrl);
  await dbSet('media', id, dataUrl);
  return 'media:' + id;
}
export function mediaUrl(ref) {
  if (!ref) return '';
  if (ref.startsWith('media:')) return S.media.get(ref.slice(6)) || '';
  if (ref.startsWith('data:') || ref.startsWith('http')) return ref;
  return '';
}

// ───────────── backup (compatible with the Android BackupStore ZIP: data.json + media/…) ─────────────
const MEDIA_RE = /media:[A-Za-z0-9-]+/g;
const ZIPMEDIA_RE = /zipmedia:[A-Za-z0-9._-]+/g;
function rewriteStrings(node, fn) {
  if (Array.isArray(node)) node.forEach((v, i) => { if (typeof v === 'string') node[i] = fn(v); else if (v && typeof v === 'object') rewriteStrings(v, fn); });
  else if (node && typeof node === 'object') for (const k of Object.keys(node)) { const v = node[k]; if (typeof v === 'string') node[k] = fn(v); else if (v && typeof v === 'object') rewriteStrings(v, fn); }
}
export async function exportBackup() {
  const copy = JSON.parse(JSON.stringify(S.data));
  const files = [], seen = new Map();
  rewriteStrings(copy, (s) => s.replace(MEDIA_RE, (m) => {
    if (seen.has(m)) return seen.get(m);
    const url = S.media.get(m.slice(6));
    const parsed = url && dataUrlToBytes(url);
    if (!parsed) return m;
    const ext = { 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[parsed.mime] || '.jpg';
    const name = uid() + ext;
    files.push({ name: 'media/' + name, data: parsed.bytes });
    seen.set(m, 'zipmedia:' + name);
    return 'zipmedia:' + name;
  }));
  const enc = new TextEncoder();
  const all = [{ name: 'data.json', data: enc.encode(JSON.stringify(copy, null, 2)) }, ...files,
    { name: 'README.txt', data: enc.encode('DeepLine local backup. Includes AI API keys and chat history. Keep this file private.') }];
  download(makeZip(all), 'DeepLine-backup.zip');
}
/** mode: 'full' replaces everything; 'personas' adds the AI characters from the backup. */
export async function importBackup(file, mode) {
  const entries = await readZip(await file.arrayBuffer());
  const dj = entries.get('data.json');
  if (!dj) throw new Error('ZIP 中没有 data.json，不是 DeepLine 备份文件');
  const json = JSON.parse(new TextDecoder().decode(dj));
  const mediaMap = new Map();
  for (const [name, bytes] of entries) {
    if (!name.startsWith('media/')) continue;
    const base = name.slice(6).split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_');
    const ref = await addMediaDataUrl(bytesToDataUrl(bytes, mimeFromName(base)));
    mediaMap.set(base, ref);
  }
  rewriteStrings(json, (s) => s.replace(ZIPMEDIA_RE, (m) => mediaMap.get(m.slice(9).replace(/[^A-Za-z0-9._-]/g, '_')) || m));
  if (mode === 'full') {
    S.data = Object.assign({}, structuredClone(DEFAULTS), json);
    for (const k of ['personas', 'posts', 'groups']) if (!Array.isArray(S.data[k])) S.data[k] = [];
    touch();
    return `已恢复完整备份：${S.data.personas.length} 个 AI。`;
  }
  const incoming = Array.isArray(json.personas) ? json.personas : [];
  let added = 0;
  for (const p of incoming) {
    if (S.data.personas.length >= 10) break;
    const clone = JSON.parse(JSON.stringify(p));
    clone.id = String(Date.now() + added);
    S.data.personas.push(clone); added++;
  }
  touch();
  return added ? `已导入 ${added} 个 AI。` : '备份里没有可导入的 AI（或已达 10 个上限）。';
}
export { readFileAsDataUrl };
