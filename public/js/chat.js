// DeepLine web — iMessage-style chat (direct + group)
import { h, uid, clock, separatorTime, isEmojiOnly, playSfx } from './lib.js';
import { icon } from './icons.js';
import { S, get, touch, save, personas, findPersona, findGroup, setError, sound, toast, mediaUrl, addMediaFromFile } from './state.js';
import { nav, go, goBack, registerView, avatarEl, press, menu, modal, pickFile, chatDark, mix, totalUnread, unreadOf, addOverlay, applyTheme } from './core.js';
import { sendDirect, sendGroup } from './logic.js';

const IMG_RE = /\[\[IMAGE:([\s\S]*?)\]\]/, GIF_RE = /\[\[GIF:([\s\S]*?)\]\]/, ATTACH_RE = /\[\[(IMAGE|GIF):([\s\S]*?)\]\]/;
const REACTS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
let draft = '', attach = '';   // composer text + attachment marker survive tab switches within a session

function bubbleVars(root) {
  const dark = root.classList.contains('dark');
  const sent = get('myBubbleColor'), recv = get('bubbleColor');
  root.style.setProperty('--sent', sent); root.style.setProperty('--sent-top', mix(sent, '#ffffff', 0.16));
  root.style.setProperty('--sent-text', get('myTextColor').toLowerCase() === '#243047' ? '#fff' : get('myTextColor'));
  const customRecv = recv.toLowerCase() !== '#ffffff';
  const r = customRecv ? recv : dark ? '#3a3a3f' : '#e9e9eb';
  root.style.setProperty('--recv', r); root.style.setProperty('--recv-top', mix(r, '#ffffff', 0.12));
  const at = get('aiTextColor').toLowerCase() === '#263247';
  root.style.setProperty('--recv-text', at ? (dark ? '#fff' : '#111') : get('aiTextColor'));
}
function buildEntries(arr) {
  const msgs = arr.filter(Boolean), seen = new Set();
  const same = (a, b) => a && b && a.type !== 'summary' && b.type !== 'summary' && a.role === b.role;
  return msgs.map((m, i) => {
    let key = m.id || 'idx' + i; while (seen.has(key)) key += '_'; seen.add(key);
    const prev = msgs[i - 1], next = msgs[i + 1];
    const ts = m.time || 0, pts = prev ? prev.time || 0 : 0;
    const label = ts && m.type !== 'summary' && (!prev || !pts || ts - pts > 20 * 60000) ? separatorTime(ts) : null;
    return { m, key, label, startRun: !same(prev, m) || !!label, endRun: !same(m, next), aiStart: m.role === 'assistant' && m.type !== 'summary' && !(prev && prev.role === 'assistant' && prev.type !== 'summary'), aiEnd: m.role === 'assistant' && m.type !== 'summary' && !(next && next.role === 'assistant' && next.type !== 'summary') };
  });
}

// ───────────── shared bubble renderer ─────────────
function bubbleEl(text, out, tail, extra = '') {
  const el = h('div', { class: 'bubble' + (tail ? ' tail' : '') + extra }, text);
  const bgImg = mediaUrl(get('bubbleBackground'));
  if (bgImg) { el.style.backgroundImage = `url("${bgImg}"), linear-gradient(180deg, var(${out ? '--sent-top' : '--recv-top'}, ${out ? '#4aa6ff' : '#ececee'}), var(${out ? '--sent' : '--recv'}, ${out ? '#0a7bff' : '#e3e3e6'}))`; el.style.backgroundBlendMode = 'soft-light, normal'; el.style.backgroundSize = 'cover'; }
  return el;
}
const typingEl = () => h('div', { class: 'bubble typing tail' }, h('i'), h('i'), h('i'));

// ───────────── direct chat ─────────────
function chatView() {
  const p = findPersona(nav.id);
  if (!p) { queueMicrotask(() => go('home', {}, false)); return { el: h('div') }; }
  const root = h('div', { class: 'screen chat' + (chatDark() ? ' dark' : '') });
  bubbleVars(root);
  const seen = new Set(), details = new Set(), reasoningOpen = new Set();
  let first = true, prevCount = -1, panelOpen = false;

  // header
  const backPill = h('button', { class: 'back-pill glass s2 bounce', 'aria-label': '返回', onClick: () => goBack() });
  const nameCap = h('button', { class: 'name-cap glass s2 bounce' });
  const headMid = h('div', { class: 'head-mid' });
  const vid = h('button', { class: 'vid-btn glass s2 bounce', 'aria-label': '语音通话', onClick: () => voiceDialog(p) }, icon('video', 25));
  const drawHead = () => {
    const others = Math.max(0, totalUnread() - unreadOf(p));
    backPill.replaceChildren(icon('left', 28), others ? h('span', { class: 'cnt' }, others > 99 ? '99+' : String(others)) : null);
    nameCap.replaceChildren(h('span', null, p.name || 'AI'), icon('right', 18));
    headMid.replaceChildren(h('div', { class: 'bounce', onClick: () => headerMenu() }, avatarEl(p.avatar, p.name, 66)), nameCap, get('conversationSummaryEnabled') ? h('small', null, '记忆自动总结已开启') : null);
  };
  const headerMenu = () => menu(nameCap, [{ label: '编辑人设', onClick: () => go('editor', { id: p.id }) }, { label: '语音通话', onClick: () => voiceDialog(p) }, { label: '返回信息列表', onClick: () => goBack() }]);
  nameCap.addEventListener('click', headerMenu);

  const msgs = h('div', { class: 'msgs' });
  const errEl = h('div', { class: 'errchip glass s3', hidden: true, onClick: () => setError('') });
  const panel = h('div', { class: 'panel glass s3', hidden: true });
  const attachEl = h('div');
  const ta = h('textarea', { rows: 1, placeholder: get('inputHint') || 'iMessage信息', 'aria-label': '消息输入框' });
  ta.value = draft;
  const trailing = h('span', { style: 'display:contents' });
  const plus = h('button', { class: 'plus glass s2 bounce', 'aria-label': '展开功能', onClick: () => { panelOpen = !panelOpen; plus.classList.toggle('open', panelOpen); panel.hidden = !panelOpen; if (panelOpen) panel.replaceChildren(...panelItems()); } }, icon('add', 26));
  const composer = h('div', { class: 'composer' }, plus, h('div', { class: 'field glass s2' }, ta, trailing));

  function panelItems() {
    const it = (label, ic, color, delay, fn) => h('button', { class: 'pitem bounce pop-in', style: `animation-delay:${delay}ms`, onClick: () => { panelOpen = false; plus.classList.remove('open'); panel.hidden = true; fn(); } }, h('div', { class: 'ic glass s2', style: 'color:' + color }, icon(ic, 28)), label);
    return [it('图片', 'image', '#3b9af5', 0, () => pickFile('image/*', (f) => attachFile(f, 'IMAGE'))), it('GIF', 'gif', '#af52de', 50, () => pickFile('image/gif', (f) => attachFile(f, 'GIF'))),
      it('红包', 'gift', '#e75b56', 100, () => paymentDialog(p, 'redpacket')), it('转账', 'swap', '#17a979', 150, () => paymentDialog(p, 'transfer'))];
  }
  async function attachFile(file, kind) {
    try { const ref = await addMediaFromFile(file, kind === 'GIF' ? 4096 : 1280); attach = `[[${kind}:${ref}]]`; drawAttach(); drawTrailing(); }
    catch (e) { toast(e.message || '无法读取图片'); }
  }
  function drawAttach() {
    const m = ATTACH_RE.exec(attach);
    attachEl.replaceChildren(m ? h('div', { class: 'attach-prev pop-in' }, h('img', { src: mediaUrl(m[2]), alt: '附件' }), h('button', { class: 'x bounce', 'aria-label': '移除附件', onClick: () => { attach = ''; drawAttach(); drawTrailing(); } }, icon('close', 14))) : null);
  }
  function canSend() { return !S.busy && (ta.value.trim() || attach); }
  function drawTrailing() {
    if (canSend()) trailing.replaceChildren(h('button', { class: 'sendbtn bounce', 'aria-label': '发送消息', onClick: doSend }, icon('up', 20)));
    else trailing.replaceChildren(h('button', { class: 'micbtn bounce', 'aria-label': '语音输入', onClick: () => dictate(ta, () => { draft = ta.value; drawTrailing(); }) }, icon('mic', 22)));
  }
  async function doSend() {
    if (!canSend()) return;
    const msg = ta.value + attach, savedText = ta.value, savedAttach = attach;
    ta.value = ''; draft = ''; attach = ''; drawAttach(); drawTrailing(); autosize();
    const ok = await sendDirect(p, msg);
    if (ok === false && !ta.value) { ta.value = savedText; draft = savedText; attach = savedAttach; drawAttach(); drawTrailing(); autosize(); }
  }
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(132, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', () => { draft = ta.value; autosize(); drawTrailing(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); doSend(); } });

  // messages
  function entryNodes(e) {
    const m = e.m, out = m.role === 'user', content = m.content || '';
    if (m.type === 'summary') return [h('div', { class: 'sumnote' }, h('small', null, `对话阶段总结 · 第 ${m.summaryThrough || 50} 条`), h('p', { class: 'glass s2' }, content))];
    const nodes = [];
    if (e.label) nodes.push(h('div', { class: 'sep' }, e.label));
    const isNew = !first && !seen.has(e.key); seen.add(e.key);
    const row = h('div', { class: `mrow ${out ? 'out' : 'in'}${e.startRun && !e.label ? ' start' : ''}${m.reaction ? ' react' : ''}${isNew ? ' pop-in' : ''}`, style: isNew ? `transform-origin:${out ? 'right' : 'left'} bottom` : '' });
    const typing = content === '---', expanded = details.has(e.key);
    if (!out && e.aiStart && m.reasoning) {
      const open = reasoningOpen.has(e.key);
      row.append(h('button', { class: 'rchip glass s2 bounce', onClick: () => { open ? reasoningOpen.delete(e.key) : reasoningOpen.add(e.key); renderMsgs(); } }, '思考摘要', icon(open ? 'upc' : 'down', 18)));
      if (open) row.append(h('div', { class: 'rtext glass s2' }, m.reasoning.slice(0, 1800)));
    }
    const line = h('div', { class: 'mline' });
    const longp = () => { if (!typing) tapback(p, m, out, () => {}); };
    const tap = () => { if (typing) return; expanded ? details.delete(e.key) : details.add(e.key); renderMsgs(); };
    let body;
    if (typing) body = typingEl();
    else if (m.type === 'payment') body = payCard(p, m, out);
    else if (content.includes('[[IMAGE:')) {
      const ref = IMG_RE.exec(content)[1], caption = content.split('[[IMAGE:')[0].trim();
      body = h('div', { style: `display:flex;flex-direction:column;gap:2px;align-items:${out ? 'flex-end' : 'flex-start'}` }, h('img', { class: 'mphoto', src: mediaUrl(ref), alt: '图片', style: mediaUrl(ref) ? '' : 'width:160px;height:100px' }), caption ? bubbleEl(caption, out, e.endRun) : null);
    } else if (GIF_RE.test(content)) body = h('img', { class: 'mphoto', src: mediaUrl(GIF_RE.exec(content)[1]), alt: 'GIF' });
    else if (isEmojiOnly(content)) body = h('div', { class: 'emoji-big' }, content.trim());
    else body = bubbleEl(content, out, e.endRun);
    press(body, { onTap: tap, onLong: longp });
    line.append(body);
    if (m.reaction) line.append(h('span', { class: 'react-badge' }, m.reaction));
    row.append(line);
    if (out && (e.key === lastUserKey || expanded)) row.append(h('div', { class: 'status' }, m.time ? clock(m.time) : '', h('b', null, m.read ? '已读' : '已送达')));
    if (!out && !typing && (e.aiEnd || expanded)) {
      const parts = [m.model || p.model || '', m.tokens ? `${m.tokens.toLocaleString('en-US')} tokens` : '', m.time ? clock(m.time) : ''].filter(Boolean);
      row.append(h('div', { class: 'meta' }, parts.join('  ✦  ')));
    }
    nodes.push(row);
    return nodes;
  }
  let lastUserKey = null;
  function renderMsgs() {
    const entries = buildEntries(p.messages || []);
    const lu = [...entries].reverse().find((e) => e.m.role === 'user'); lastUserKey = lu ? lu.key : null;
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
    const keep = msgs.scrollTop;
    msgs.replaceChildren(...entries.flatMap(entryNodes));
    entries.forEach((e) => seen.add(e.key));
    const grew = entries.length !== prevCount; prevCount = entries.length;
    if (first) { msgs.scrollTop = msgs.scrollHeight; }
    else if (grew || nearBottom) msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
    else msgs.scrollTop = keep;
    first = false;
  }
  function markRead() { let ch = false; for (const m of p.messages || []) if (m.role === 'assistant' && m.read === false && m.content !== '---') { m.read = true; ch = true; } if (ch) save(); }
  function drawError() { errEl.hidden = !S.error; errEl.textContent = S.error; errEl.style.color = /^(请求失败|发送失败)/.test(S.error) ? '#ff6b6b' : ''; }
  function afterMount() { renderMsgs(); autosize(); }
  root.append(h('div', { class: 'chat-head' }, backPill, headMid, vid), msgs, errEl, panel, attachEl, composer);
  markRead(); drawHead(); drawAttach(); drawTrailing(); drawError();
  return { el: root, afterMount, update() { markRead(); drawHead(); renderMsgs(); drawTrailing(); },
    onBusy() { drawTrailing(); }, onError() { drawError(); } };
}
registerView('chat', chatView);

function payCard(p, m, out) {
  const red = m.paymentType === 'redpacket', rejected = m.status === 'rejected';
  const st = m.status === 'accepted' ? (out ? '对方已收下' : '你已收下') : rejected ? (out ? '对方已拒绝' : '你已拒绝') : `等待${out ? '对方' : '你'}处理`;
  const mayDecide = !out && (m.status || 'pending') === 'pending';
  const card = h('div', { class: 'pay', style: `--pc:${rejected ? '#9aa3ad' : red ? '#e8574d' : '#17a97a'}` },
    h('div', { class: 'top' }, h('div', { class: 'ic' }, icon(red ? 'gift' : 'swap', 23)), h('div', null, h('b', null, red ? '虚拟红包' : '虚拟转账'), h('small', null, m.note || (red ? '恭喜发财' : '请收下')))),
    h('div', { class: 'amt' }, '¥' + m.amount), h('div', { class: 'st' }, st),
    mayDecide ? h('div', { class: 'acts2' }, h('button', { class: 'yes bounce', onClick: (e) => { e.stopPropagation(); decide(p, m, true); } }, red ? '收下红包' : '确认收下'), h('button', { class: 'no bounce', onClick: (e) => { e.stopPropagation(); decide(p, m, false); } }, '拒绝')) : null,
    h('em', null, '仅应用内 UI，不涉及真实资金'));
  return card;
}
function decide(p, m, accepted) {
  if ((m.status || 'pending') !== 'pending') return;
  m.status = accepted ? 'accepted' : 'rejected'; touch();
  if (accepted && sound()) playSfx('success');
  sendDirect(p, accepted ? '我收下了你发来的应用内虚拟礼物，谢谢你。' : '我暂时不收这份应用内虚拟礼物，但谢谢你的心意。');
}
function paymentDialog(p, kind) {
  const amount = h('input', { type: 'text', inputmode: 'decimal', value: '10.00', style: 'width:100%;border:1px solid #dde3ea;border-radius:14px;padding:10px;font-size:16px;margin:4px 0' });
  const note = h('input', { type: 'text', value: kind === 'redpacket' ? '一点心意' : '请收下', maxlength: 60, style: 'width:100%;border:1px solid #dde3ea;border-radius:14px;padding:10px;font-size:16px;margin:4px 0' });
  amount.addEventListener('input', () => { amount.value = amount.value.replace(/[^0-9.]/g, '').slice(0, 9); });
  modal({ title: kind === 'redpacket' ? '发送红包' : '发送转账', body: [h('p', { style: 'font-size:12px;color:#6f7b88' }, '仅为 DeepLine 内的虚拟互动，不会产生真实支付。'), h('label', { style: 'font-size:12px;color:#6f7b88' }, '金额（金币）', amount), h('label', { style: 'font-size:12px;color:#6f7b88' }, '备注', note)],
    actions: [{ label: '取消' }, { label: '发送', kind: 'p', onClick: () => {
      const v = parseFloat(amount.value);
      if (!(v > 0) || v > 999999.99) { toast('请输入有效金额（0–999999.99）'); return false; }
      sendDirect(p, `[[PAYMENT:${kind}:${v.toFixed(2)}:${note.value.replace(/\]\]/g, '')}]]`);
    } }] });
}

// ───────────── tapback (long-press menu) ─────────────
function tapback(p, m, out, done) {
  const dark = chatDark();
  const preview = m.type === 'payment' ? `[虚拟${m.paymentType === 'redpacket' ? '红包' : '转账'}] ¥${m.amount}` : (m.content || '').includes('[[IMAGE:') ? '[图片] ' + m.content.split('[[IMAGE:')[0].trim() : GIF_RE.test(m.content || '') ? '[动图]' : m.content || '';
  let remove;
  const close = () => { remove(); done(); };
  const rx = h('div', { class: 'rx glass s3 pop-in' }, REACTS.map((r, i) => h('button', { class: 'bounce' + (m.reaction === r ? ' on' : ''), style: `animation-delay:${i * 35}ms`, onClick: () => { m.reaction = m.reaction === r ? '' : r; if (!m.reaction) delete m.reaction; touch(); if (sound()) playSfx('pop'); close(); } }, r)));
  const act = (label, ic, fn, cls = '') => h('button', { class: cls + ' bounce soft', onClick: () => { fn(); close(); } }, label, icon(ic, 20));
  const acts = h('div', { class: 'acts glass s3 pop-in', style: 'animation-delay:60ms;display:flex' },
    act('复制', 'copy', () => navigator.clipboard && navigator.clipboard.writeText(preview).catch(() => {})),
    act('引用', 'quote', () => { const ta = document.querySelector('.composer textarea'); if (ta) { ta.value = `「${preview.slice(0, 500)}」\n`; ta.dispatchEvent(new Event('input')); ta.focus(); } }),
    act('删除', 'del', () => { p.messages = (p.messages || []).filter((x) => x !== m); touch(); }, 'del'));
  const wrap = h('div', { class: 'modal-back chat' + (dark ? ' dark' : ''), onPointerdown: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'tapback' }, out ? null : rx, h('div', { class: 'prev glass s3 pop-in' }, preview.slice(0, 160)), acts));
  remove = addOverlay(wrap);
}

// ───────────── voice (speech recognition → AI text reply) ─────────────
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
function dictate(ta, after) {
  const R = SR(); if (!R) return toast('当前浏览器不支持语音识别（建议用 Chrome / Edge / Safari）');
  const rec = new R(); rec.lang = 'zh-CN'; rec.interimResults = false;
  rec.onresult = (e) => { ta.value += Array.from(e.results).map((r) => r[0].transcript).join(''); after(); };
  rec.onerror = (e) => toast('语音识别失败：' + (e.error === 'not-allowed' ? '没有麦克风权限' : e.error));
  try { rec.start(); toast('请说话…'); } catch { /* already started */ }
}
function voiceDialog(p) {
  const R = SR();
  let rec = null, active = false, remove;
  const status = h('div', { style: 'text-align:center;font-size:14px;opacity:.8' }, R ? '点击麦克风，用中文说话；AI 将以文字回复' : '当前浏览器不支持语音识别，请在聊天框里直接输入文字');
  const heard = h('div', { style: 'text-align:center;font-size:12px;opacity:.6;min-height:16px' });
  const reply = h('div', { class: 'box' }, '说完话后，AI 的文字回复会显示在这里。');
  const mic = h('button', { class: 'bounce', 'aria-label': '开始说话' }, icon('mic', 29));
  const stop = () => { active = false; try { rec && rec.abort(); } catch { /* ignore */ } };
  const listen = () => {
    if (!R) return;
    rec = new R(); rec.lang = 'zh-CN'; rec.interimResults = false;
    rec.onresult = async (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join('').trim(); if (!text) return;
      heard.textContent = '你说：' + text; status.textContent = 'AI 正在回复…'; active = false;
      await sendDirect(p, text);
      const last = [...(p.messages || [])].reverse().find((m) => m.role === 'assistant' && m.content !== '---' && m.type !== 'summary');
      reply.textContent = last ? last.content.slice(0, 1200) : ''; status.textContent = '点击麦克风继续说话';
    };
    rec.onerror = (e) => { status.textContent = '语音识别失败：' + (e.error === 'not-allowed' ? '没有麦克风权限' : e.error); active = false; };
    rec.onend = () => { active = false; };
    try { rec.start(); active = true; status.textContent = '正在听…'; } catch { /* ignore */ }
  };
  mic.addEventListener('click', () => { if (active) { stop(); status.textContent = '语音监听已暂停'; } else listen(); });
  const end = h('button', { class: 'end bounce', 'aria-label': '结束', onClick: () => { stop(); remove(); } }, icon('callEnd', 29));
  const el = h('div', { class: 'voice' }, h('div', { style: 'align-self:stretch;display:flex;justify-content:flex-end' }, h('button', { class: 'bounce', style: 'width:43px;height:43px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center', onClick: () => { stop(); remove(); } }, icon('close', 22))),
    h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:12px;width:100%' }, avatarEl(p.avatar, p.name, 124), h('div', { style: 'font-size:27px;font-weight:700' }, p.name), h('div', { style: 'font-size:13px;opacity:.6' }, p.relationship || 'AI 好友'), status, heard, reply),
    h('div', { class: 'ctrl' }, mic, end));
  remove = addOverlay(el);
}

// ───────────── group chat ─────────────
function groupChatView() {
  const g = findGroup(nav.id);
  if (!g) { queueMicrotask(() => go('home', {}, false)); return { el: h('div') }; }
  const root = h('div', { class: 'screen chat' + (chatDark() ? ' dark' : '') });
  bubbleVars(root);
  const msgs = h('div', { class: 'msgs' });
  const errEl = h('div', { class: 'errchip glass s3', hidden: true });
  const seen = new Set(); let first = true, prevCount = -1;
  const ta = h('textarea', { rows: 1, placeholder: 'iMessage信息', 'aria-label': '消息输入框' });
  const trailing = h('span', { style: 'display:contents' });
  const drawTrailing = () => trailing.replaceChildren(h('button', { class: 'sendbtn bounce', style: ta.value.trim() && !S.busy ? '' : 'opacity:.35', 'aria-label': '发送', onClick: send }, icon('up', 20)));
  async function send() { const t = ta.value.trim(); if (!t || S.busy) return; ta.value = ''; autosize(); drawTrailing(); sendGroup(g, t); }
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(132, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', () => { autosize(); drawTrailing(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });
  function render() {
    const arr = (g.messages || []).filter(Boolean), nodes = [];
    arr.forEach((m, i) => {
      const out = m.role === 'user', prev = arr[i - 1], next = arr[i + 1];
      const sameP = prev && prev.role === m.role && prev.speakerId === m.speakerId, sameN = next && next.role === m.role && next.speakerId === m.speakerId;
      const key = m.id || 'g' + i, isNew = !first && !seen.has(key); seen.add(key);
      const ts = m.time || 0, pts = prev ? prev.time || 0 : 0;
      if (ts && (!prev || !pts || ts - pts > 20 * 60000)) nodes.push(h('div', { class: 'sep' }, separatorTime(ts)));
      const typing = m.content === '---';
      const row = h('div', { class: `mrow ${out ? 'out' : 'in'}${!sameP ? ' start' : ''}${isNew ? ' pop-in' : ''}` });
      if (!out && !sameP && m.speakerName) row.append(h('div', { class: 'meta', style: 'margin:0 0 2px 44px' }, m.speakerName));
      const line = h('div', { style: 'display:flex;align-items:flex-end;gap:4px;max-width:92%' });
      if (!out) line.append(h('div', { style: 'width:36px;flex:none' }, !sameN && m.speakerId ? avatarEl((findPersonaSafe(m.speakerId) || {}).avatar, m.speakerName, 32) : null));
      line.append(h('div', { class: 'mline', style: 'max-width:none' }, typing ? typingEl() : bubbleEl(m.content, out, !sameN)));
      row.append(line);
      if (!sameN && ts && !typing) row.append(h('div', { class: 'meta', style: 'margin:3px 6px 0 44px' }, clock(ts)));
      nodes.push(row);
    });
    msgs.replaceChildren(...nodes);
    const grew = arr.length !== prevCount; prevCount = arr.length;
    if (first) msgs.scrollTop = msgs.scrollHeight; else if (grew) msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
    first = false;
  }
  const head = h('div', { class: 'chat-head' },
    h('button', { class: 'back-pill glass s2 bounce', 'aria-label': '返回', onClick: () => goBack() }, icon('left', 28)),
    h('div', { class: 'head-mid' }, h('div', { class: 'avatar glass s2', style: 'width:66px;height:66px;background:none;color:var(--ink)' }, icon('groups', 36)), h('div', { class: 'name-cap glass s2' }, h('span', null, g.name || '群聊')), h('small', null, `${(g.memberIds || []).length} 位 AI`)));
  root.append(head, msgs, errEl, h('div', { class: 'composer' }, h('div', { class: 'field glass s2', style: 'margin-left:0' }, ta, trailing)));
  drawTrailing();
  return { el: root, afterMount() { render(); }, update() { render(); drawTrailing(); }, onBusy() { drawTrailing(); },
    onError() { errEl.hidden = !S.error; errEl.textContent = S.error; } };
}
const findPersonaSafe = (id) => personas().find((p) => p.id === id);
registerView('groupChat', groupChatView);
