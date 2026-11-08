// DeepLine web — shared helpers: DOM, storage (IndexedDB), ZIP, sounds, AI gateway.

// Element.append / replaceChildren stringify null — make them skip null/undefined/false and accept arrays.
const cleanNodes = (n) => n.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, cleanNodes(nodes)); };
}

// ───────────── DOM helper ─────────────
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
export const $ = (s, el = document) => el.querySelector(s);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ───────────── time ─────────────
const pad = (n) => String(n).padStart(2, '0');
export const clock = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function listTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  if (sameDay(d, n)) return clock(ts);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return '昨天';
  return d.getFullYear() === n.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  const d = new Date(ts), n = new Date();
  if (sameDay(d, n)) return '今天 ' + clock(ts);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return '昨天 ' + clock(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${clock(ts)}`;
}
export function separatorTime(ts) {
  const d = new Date(ts), n = new Date();
  if (sameDay(d, n)) return '今天 ' + clock(ts);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return '昨天 ' + clock(ts);
  return (d.getFullYear() === n.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日 ` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 `) + clock(ts);
}

// ───────────── emoji-only detection (1–3 emoji → big, no bubble) ─────────────
export function isEmojiOnly(s) {
  const t = (s || '').trim();
  if (!t || t.length > 24) return false;
  let count = 0, zwj = false;
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    const ok = cp === 0x200d || cp === 0xfe0f || cp === 0x20e3 || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) || cp === 0x203c || cp === 0x2049 || cp === 0x2b50 || cp === 0x2b55;
    if (!ok) return false;
    if (cp === 0x200d) zwj = true;
    if (cp !== 0x200d && cp !== 0xfe0f && cp !== 0x20e3 && !(cp >= 0x1f3fb && cp <= 0x1f3ff)) count++;
  }
  return (count >= 1 && count <= 3) || (zwj && count >= 1 && count <= 8);
}

// ───────────── IndexedDB (data JSON + media blobs as data URLs) ─────────────
let dbp;
function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open('deepline-web', 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('kv'); db.createObjectStore('media'); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const res = fn(t.objectStore(store));
    t.oncomplete = () => resolve(res && res.result !== undefined ? res.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const dbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const dbSet = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key));
export const dbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export async function dbAllMedia() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = new Map();
    const rq = db.transaction('media', 'readonly').objectStore('media').openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out); };
    rq.onerror = () => reject(rq.error);
  });
}
export async function persistRequest() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ } }

// ───────────── images ─────────────
export function readFileAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
/** Down-scales a picked image (keeps GIFs untouched) so storage and API payloads stay small. */
export async function prepareImage(file, maxEdge = 1280, quality = 0.82) {
  if (file.type === 'image/gif') return readFileAsDataUrl(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('无法读取这张图片')); i.src = url; });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    c.getContext('2d').drawImage(img, 0, 0, w, hgt);
    return c.toDataURL(file.type === 'image/png' && file.size < 400000 ? 'image/png' : 'image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}
export async function luminanceOf(src) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4 * 255);
  } catch { return 0.85; }
}

// ───────────── ZIP (store-only writer, stored/deflate reader) — compatible with the Android backup ZIP ─────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer), dv = new DataView(buffer), dec = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持读取压缩 ZIP，请换用较新的 Chrome / Edge / Safari');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}
export function dataUrlToBytes(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1] || 'application/octet-stream', bytes };
}
export function bytesToDataUrl(bytes, mime) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,` + btoa(bin);
}
export function mimeFromName(name) {
  const e = name.split('.').pop().toLowerCase();
  return { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[e] || 'image/jpeg';
}
export function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ───────────── sound effects (preloaded, low latency) ─────────────
const sfxBuffers = {};
let actx = null;
const SFX_FILES = { send: 'dl_send', receive: 'dl_receive', pop: 'dl_pop', success: 'dl_success' };
export async function initSfx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    await Promise.all(Object.entries(SFX_FILES).map(async ([k, f]) => {
      const buf = await (await fetch(`/sounds/${f}.wav`)).arrayBuffer();
      sfxBuffers[k] = await actx.decodeAudioData(buf);
    }));
  } catch { /* sounds are optional */ }
}
export function unlockAudio() { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); }
export function playSfx(name, volume = 0.7) {
  try {
    if (!actx || !sfxBuffers[name]) return;
    if (actx.state === 'suspended') actx.resume();
    const src = actx.createBufferSource(); src.buffer = sfxBuffers[name];
    const g = actx.createGain(); g.gain.value = volume;
    src.connect(g).connect(actx.destination); src.start();
  } catch { /* ignore */ }
}

// ───────────── AI gateway (same providers / request shapes as the Android AiGateway) ─────────────
export const PROVIDERS = ['DeepSeek', 'Claude', '豆包', 'ChatGPT / OpenAI'];
export function defaultModel(p) {
  return { 'Claude': 'claude-sonnet-5', '豆包': 'doubao-seed-2-1-pro-260915', 'ChatGPT / OpenAI': 'gpt-4.1-mini' }[p] || 'deepseek-chat';
}
const DIRECT_URL = {
  'DeepSeek': 'https://api.deepseek.com/chat/completions', 'Claude': 'https://api.anthropic.com/v1/messages',
  '豆包': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'ChatGPT / OpenAI': 'https://api.openai.com/v1/chat/completions',
};
const ATTACH = /\[\[(?:IMAGE|GIF):([\s\S]*?)\]\]/;
const captionOf = (raw) => { const i = raw.search(/\[\[(?:IMAGE|GIF):/); return (i < 0 ? raw : raw.slice(0, i)).trim(); };

/** media resolver is injected by the app: ref -> data URL (or http URL). */
let resolveMedia = (ref) => ref;
export function setMediaResolver(fn) { resolveMedia = fn; }

function imagePart(ref) {
  const url = resolveMedia(ref);
  const parsed = url && url.startsWith('data:') ? dataUrlToBytes(url) : null;
  if (!parsed) throw new Error('图片文件找不到，无法把真实图片发送给 AI。请重新选择图片。');
  return { mime: parsed.mime, b64: url.split(',')[1], url };
}

function buildOpenAiBody(provider, model, system, history, deepThinking) {
  if (provider === 'DeepSeek' && history.some((m) => ATTACH.test(m.content || ''))) {
    throw new Error('当前 DeepSeek 文本模型不能保证直接识图。请将该 AI 切换到支持视觉输入的 Claude、ChatGPT 或豆包视觉模型；应用不会把图片伪装成文字标签。');
  }
  const messages = [{ role: 'system', content: system }];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const raw = m.content || '';
    const mm = ATTACH.exec(raw);
    if (mm) {
      const img = imagePart(mm[1]);
      messages.push({ role, content: [{ type: 'text', text: captionOf(raw) || '请认真查看这张实际上传的图片，描述你能确认的内容，并回答用户的问题。' }, { type: 'image_url', image_url: { url: img.url, detail: 'high' } }] });
    } else messages.push({ role, content: raw });
  }
  const body = { model, messages, max_tokens: 2048 };
  if (provider === 'DeepSeek' && deepThinking) body.thinking = { type: 'enabled' };
  return body;
}
function buildClaudeBody(model, system, history) {
  const messages = [];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const raw = m.content || '';
    const mm = ATTACH.exec(raw);
    if (mm) {
      const img = imagePart(mm[1]);
      messages.push({ role, content: [{ type: 'text', text: captionOf(raw) || '请查看这张真实图片并分析可见内容。' }, { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } }] });
    } else messages.push({ role, content: raw });
  }
  return { model, max_tokens: 2048, system, messages };
}

/** returns { text, reasoning, totalTokens, model } */
export async function replyDetailed({ provider, apiKey, model, system, history, deepThinking = false, direct = false }) {
  if (!apiKey || !apiKey.trim()) throw new Error('请先填写所选服务商的 API Key');
  const p = provider || 'DeepSeek';
  const m = model || defaultModel(p);
  const sys = deepThinking ? system + '\n\n请启用更审慎的分析模式：先充分检查上下文、条件和可能的歧义，再给出清晰、准确、简洁的最终答复。不要输出隐藏的逐步推理过程，只呈现结论和必要的简短解释。' : system;
  const body = p === 'Claude' ? buildClaudeBody(m, sys, history) : buildOpenAiBody(p, m, sys, history, deepThinking);
  const headers = p === 'Claude' ? { 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + apiKey.trim() };
  let resp;
  try {
    if (direct) {
      const dh = { 'Content-Type': 'application/json', ...headers };
      if (p === 'Claude') dh['anthropic-dangerous-direct-browser-access'] = 'true';
      resp = await fetch(DIRECT_URL[p], { method: 'POST', headers: dh, body: JSON.stringify(body) });
    } else {
      resp = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: p, headers, body }) });
    }
  } catch (e) {
    throw new Error(`${p} 请求失败：无法连接${direct ? '（浏览器直连可能被该服务商的跨域策略拦截，请在设置里改回「经服务器转发」）' : '服务器'}。`);
  }
  const raw = await resp.text();
  let json = {};
  try { json = JSON.parse(raw); } catch { /* not json */ }
  if (!resp.ok) {
    const detail = (json.error && (json.error.message || (typeof json.error === 'string' ? json.error : ''))) || json.message || raw.slice(0, 400) || '接口未返回错误详情';
    throw new Error(`${p} 请求失败（HTTP ${resp.status}）：${detail}`);
  }
  let answer;
  if (p === 'Claude') answer = (json.content || []).map((b) => b && b.text).filter(Boolean).join('\n');
  else {
    const c = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    answer = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x && x.text).filter(Boolean).join('\n') : null;
  }
  const text = (answer || '').trim();
  if (!text) throw new Error(`${p} 接口返回成功，但没有可显示的回复。`);
  const usage = json.usage || {};
  const totalTokens = p === 'Claude' ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : usage.total_tokens || 0;
  let reasoning = '';
  if (p !== 'Claude') { const r = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.reasoning_content; reasoning = r && String(r).toLowerCase() !== 'null' ? String(r).trim() : ''; }
  return { text, reasoning, totalTokens, model: m };
}
