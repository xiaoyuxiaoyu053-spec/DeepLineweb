// DeepLine web — conversation logic (ported from the Android MainActivity, same prompts and markers).
import { uid, replyDetailed, defaultModel, sleep } from './lib.js';
import { S, get, set, touch, personas, groups, posts, findPersona, setBusy, setError, sound, emit } from './state.js';
import { playSfx } from './lib.js';

const REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
export const now = () => Date.now();
const msgBase = (role, extra) => Object.assign({ id: uid(), time: now(), role }, extra);

function call(ai, system, history, deep = false) {
  return replyDetailed({
    provider: ai.provider || 'DeepSeek', apiKey: ai.apiKey, model: ai.model || defaultModel(ai.provider || 'DeepSeek'),
    system, history, deepThinking: deep, direct: !!get('directMode'),
  });
}

// ───────────── direct chat ─────────────
export async function sendDirect(p, inputValue) {
  let msg = (inputValue || '').trim();
  if (/\[\[GIF:/.test(msg) && msg.slice(0, msg.indexOf('[[GIF:')).trim() === '') msg = '【GIF表情包】请结合这张动图的表情和当前聊天自然回应。\n' + msg;
  if (!msg || S.busy) return false;
  if (!p.messages) p.messages = [];
  const arr = p.messages;
  const pay = /^\[\[PAYMENT:(redpacket|transfer):([0-9]+(?:\.[0-9]{1,2})?):([\s\S]*?)\]\]$/.exec(msg);
  if (pay && !(parseFloat(pay[2]) > 0)) { setError('金额无效，请重新输入。'); return false; }
  const user = msgBase('user');
  if (pay) Object.assign(user, { type: 'payment', paymentType: pay[1], amount: pay[2], note: pay[3], status: 'pending', content: pay[3] });
  else if (msg.includes('[[IMAGE:')) Object.assign(user, { type: 'photo', content: msg });
  else user.content = msg;
  arr.push(user);
  arr.push(msgBase('assistant', { content: '---' }));
  touch();
  if (sound()) playSfx('send');
  setBusy(true); setError('');
  const memory = get('memoryLimit');
  try {
    const history = [];
    for (let i = Math.max(0, arr.length - (memory + 2)); i < arr.length - 1; i++) {
      const m = arr[i];
      if (m.content === '---') continue;
      let content;
      if (m.type === 'payment') content = `[应用内虚拟${m.paymentType === 'redpacket' ? '红包' : '转账'}，金额 ¥${m.amount}，备注：${m.note}，当前状态：${m.status || 'pending'}。这不涉及真实支付。请按你的人设决定是否接受。]`;
      else if (m.type === 'photo') { const mm = /\[\[IMAGE:([\s\S]*?)\]\]/.exec(m.content || ''); content = `${(m.content || '').split('[[IMAGE:')[0].trim()} [[IMAGE:${mm ? mm[1] : ''}]]`; }
      else content = m.content;
      history.push({ role: m.role, content });
    }
    const system = `你正在扮演 AI 角色。名字：${p.name}。简介：${p.bio || ''}。人设：${p.persona}。性别：${p.gender || ''}。与用户关系：${p.relationship || ''}。喜欢：${p.likes || ''}。讨厌：${p.dislikes || ''}。爱好：${p.hobbies || ''}。请遵循人设并用用户使用的语言自然回复。你是 AI，不要声称现实中不存在的经历。若消息包含 [[IMAGE:...]]，那是真实图片附件，请根据图片可见内容回答；如果模型不支持图片，接口失败时应由应用显示错误，不要假装看过。用户发来虚拟红包/转账时，请以 [收下] 或 [拒绝] 开头，并给出自然简短理由。若你想向用户发送应用内虚拟红包或转账，可在回复末尾使用精确格式 [红包|金额|备注] 或 [转账|金额|备注]，金额仅为本地 UI 示例，不能涉及真实支付；不要为了格式而强行发送。你也可以像 iMessage 的点按回应一样，偶尔在回复最开头加一个标记 [[REACT:❤️]]（表情只能是 ❤️ 👍 👎 😂 ‼️ ❓ 之一）来回应用户最后一条消息；若只想回应而不说话，可只输出该标记。不要频繁使用。记忆参考最近 ${memory} 条消息。`;
    const target = get('multiReplyEnabled') ? 1 + Math.floor(Math.random() * get('multiReplyCount')) : 1;
    const deep = !!get('deepThinkingEnabled');
    const result = await call(p, system, history, deep);
    const reply = result.text;
    const aiPay = /\[(红包|转账)\|([0-9]+(?:\.[0-9]{1,2})?)\|([^\]]*)\]/.exec(reply);
    const react = /\[\[REACT:([^\]]{1,8})\]\]/.exec(reply);
    const decisionClean = reply.replace(/\[\[REACT:[^\]]{1,8}\]\]/g, '').trim().replace(/^\s*\[(?:收下|拒绝)\]\s*/, '').trim();
    const clean = aiPay ? decisionClean.replace(aiPay[0], '').trim() : decisionClean;
    arr.forEach((m) => { if (m.role === 'user') m.read = true; });
    if (react && REACTIONS.includes(react[1].trim())) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].role === 'user' && arr[i].type !== 'payment') { arr[i].reaction = react[1].trim(); break; }
    }
    const reactionOnly = !clean && react && !aiPay;
    const decision = reply.trimStart().startsWith('[收下]') ? 'accepted' : reply.trimStart().startsWith('[拒绝]') ? 'rejected' : '';
    if (decision && pay) for (let i = arr.length - 2; i >= 0; i--) { const it = arr[i]; if (it.type === 'payment' && it.role === 'user' && (it.status || 'pending') === 'pending') { it.status = decision; break; } }
    if (reactionOnly) { arr.pop(); touch(); if (sound()) playSfx('pop'); }
    else {
      const first = msgBase('assistant', { read: false, model: result.model, tokens: result.totalTokens });
      if (aiPay) Object.assign(first, { type: 'payment', paymentType: aiPay[1] === '红包' ? 'redpacket' : 'transfer', amount: aiPay[2], note: aiPay[3], status: 'pending', content: clean });
      else first.content = clean;
      if (result.reasoning) first.reasoning = result.reasoning;
      arr[arr.length - 1] = first; touch();
      if (sound()) playSfx('receive');
    }
    for (let k = 1; k < (reactionOnly ? 1 : target); k++) {
      const follow = arr.slice(Math.max(0, arr.length - (memory + 1))).filter((m) => m.content !== '---').map((m) => ({ role: m.role, content: m.content }));
      follow.push({ role: 'user', content: '如果还有自然想补充的话，再发一条简短消息；不要重复刚才内容。' });
      arr.push(msgBase('assistant', { content: '---' })); touch();
      const extra = await call(p, system, follow, deep);
      arr[arr.length - 1] = msgBase('assistant', { content: extra.text }); touch();
    }
    if (get('conversationSummaryEnabled')) await maybeSummarize(p, deep);
  } catch (e) {
    const last = arr[arr.length - 1];
    if (last && last.content === '---') arr[arr.length - 1] = msgBase('assistant', { content: '请求失败：' + (e.message || '请检查 API 配置') });
    touch(); setError(e.message || '请求失败');
  } finally { setBusy(false); }
  return true;
}

async function maybeSummarize(p, deep) {
  const arr = p.messages;
  const real = arr.filter((m) => ['user', 'assistant'].includes(m.role) && m.content !== '---' && m.type !== 'summary');
  const done = p.summaryThrough || 0, target = Math.floor(real.length / 50) * 50;
  if (target < 50 || target <= done) return;
  const hist = real.slice(-50).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.type === 'payment' ? `[虚拟${m.paymentType === 'redpacket' ? '红包' : '转账'}：${m.amount} 金币，状态 ${m.status}]` : String(m.content).slice(0, 1200) }));
  const sys = '你是对话记录整理助手。请用中文写一段简洁、准确的阶段总结，概括最近对话的主题、已确定的信息、用户偏好、待继续的话题。不要虚构内容，不要输出标题以外的多余格式，最多 180 字。只总结提供的聊天记录。';
  let text;
  try { text = (await call(p, sys, hist, deep)).text.slice(0, 400); } catch (e) { text = `本阶段共整理至第 ${target} 条消息。自动总结暂时失败：${e.message || '请检查 API 设置'}`; }
  arr.push(msgBase('assistant', { type: 'summary', summaryThrough: target, content: text }));
  p.summaryThrough = target; touch();
}

// ───────────── group chat ─────────────
export async function sendGroup(group, input) {
  const msg = (input || '').trim();
  if (!msg || S.busy) return false;
  if (!group.messages) group.messages = [];
  const arr = group.messages;
  arr.push(msgBase('user', { speakerName: get('myName'), speakerAvatar: get('myAvatar'), content: msg, read: true }));
  touch(); if (sound()) playSfx('send');
  setBusy(true); setError('');
  try {
    const valid = (group.memberIds || []).map(findPersona).filter(Boolean);
    if (!valid.length) arr.push(msgBase('assistant', { speakerName: '系统', content: '群里没有可用的 AI 成员。' }));
    else for (const ai of valid) {
      arr.push(msgBase('assistant', { speakerName: '正在输入…', content: '---' })); touch();
      try {
        const history = [];
        for (let i = Math.max(0, arr.length - 26); i < arr.length - 1; i++) {
          const it = arr[i]; if (it.content === '---') continue;
          const role = it.role === 'assistant' ? 'assistant' : 'user';
          history.push({ role, content: role === 'assistant' ? `[群成员 ${it.speakerName || 'AI'} 说] ${it.content}` : it.content });
        }
        const others = valid.map((v) => v.name).join('、');
        const system = `你是群聊中的 AI 角色 ${ai.name}。人设：${ai.persona}。关系：${ai.relationship || ''}。喜欢：${ai.likes || ''}。爱好：${ai.hobbies || ''}。群名：${group.name}。其他成员：${others}。请读懂用户和其他 AI 的上下文，按人设自然发一条简短消息；可以偶尔回应另一位 AI，但每轮只发一条，不要无限争论。你是 AI，不要声称现实中不存在的经历。`;
        const r = await call(ai, system, history);
        arr[arr.length - 1] = msgBase('assistant', { speakerId: ai.id, speakerName: ai.name, speakerAvatar: ai.avatar, content: r.text });
        if (sound()) playSfx('receive');
      } catch (e) { arr[arr.length - 1] = msgBase('assistant', { speakerName: ai.name, content: '本条回复失败：' + (e.message || '请检查该 AI 的 API 设置') }); }
      touch();
    }
  } catch (e) { setError(e.message || '群聊请求失败'); }
  finally { setBusy(false); touch(); }
  return true;
}

// ───────────── dynamics ─────────────
export function prependPost(post) { S.data.posts.unshift(post); }
export async function reactToPost(post) {
  if (!get('aiMomentsEnabled')) return;
  for (const ai of personas().slice()) {
    try {
      const img = post.image ? `图片附件：[[IMAGE:${post.image}]]。请实际查看图片。` : '';
      const prompt = `请像这个 AI 角色本人一样，评价用户刚发布的朋友圈。正文：${post.content}。${img} 你可以选择点赞或不点赞，也可以选择留一条符合人设的简短评论。只输出 JSON：{"like":true或false,"comment":"评论内容，不评论就空字符串"}。不要解释 JSON 外的内容。`;
      const system = `你正在扮演 ${ai.name}。人设：${ai.persona}。喜好：${ai.likes || ''}。讨厌：${ai.dislikes || ''}。必须诚实表达喜欢或不喜欢，不需要为了讨好用户而点赞。评论要自然、简短，并符合人设。`;
      const r = await call(ai, system, [{ role: 'user', content: prompt }]);
      const a = r.text.indexOf('{'), b = r.text.lastIndexOf('}');
      let res = {}; try { res = JSON.parse(r.text.slice(a, b + 1)); } catch { /* ignore */ }
      post.likedBy = post.likedBy || [];
      if (res.like && !post.likedBy.includes(ai.id)) { post.likedBy.push(ai.id); post.likes = (post.likes || 0) + 1; if (sound()) playSfx('pop'); }
      const comment = String(res.comment || '').trim().slice(0, 240);
      if (comment && comment.toLowerCase() !== 'null') { (post.comments = post.comments || []).push({ id: uid(), author: ai.name, avatar: ai.avatar, content: comment, reply: '' }); if (sound()) playSfx('receive'); }
      touch();
    } catch { /* one unavailable AI must not block the others */ }
  }
}
export async function replyToComment(post, text) {
  const all = personas();
  const responders = post.ai ? all.filter((a) => a.name === post.author) : all.slice().sort(() => Math.random() - 0.5).slice(0, 2);
  for (const ai of responders) {
    try {
      const img = post.image ? `该动态还附带图片：[[IMAGE:${post.image}]]，请查看图片。` : '';
      const prompt = `动态内容：${post.content}。用户刚刚评论：${text}。请根据你的角色决定是否回复这条评论；不想回复可只输出 SKIP，只回复一条自然简短的文字。${img}`;
      const system = `你是 ${ai.name}。人设：${ai.persona}。你可以根据自己的性格决定是否回应，但不要每次都刻意讨好。`;
      const r = (await call(ai, system, [{ role: 'user', content: prompt }])).text.trim();
      if (r && r.toUpperCase() !== 'SKIP') { (post.comments = post.comments || []).push({ id: uid(), author: ai.name, avatar: ai.avatar, content: r.slice(0, 300), reply: '' }); touch(); if (sound()) playSfx('receive'); }
    } catch { /* ignore */ }
  }
}
export async function generateAiPost(ai) {
  try {
    const history = [];
    const recent = ai.messages || [];
    for (let j = Math.max(0, recent.length - 20); j < recent.length; j++) { const it = recent[j]; if (it.content !== '---') history.push({ role: it.role === 'assistant' ? 'assistant' : 'user', content: it.content }); }
    history.push({ role: 'user', content: '请基于你和用户最近的对话、你的人设，写一条像你本人会发的自然朋友圈动态。只返回动态正文，不要编造现实中实际发生过但对话里没有的事情。' });
    const system = `你正在扮演 ${ai.name}。人设：${ai.persona}。喜欢：${ai.likes || ''}。爱好：${ai.hobbies || ''}。动态内容应该结合你最近与用户的对话，像真实社交动态一样自然；不得声称 AI 实际去了某处或做过未经对话支持的现实活动。`;
    const text = (await call(ai, system, history)).text;
    prependPost({ id: uid(), time: now(), author: ai.name, avatar: ai.avatar, content: text, likes: 0, likedBy: [], comments: [], image: '', ai: true });
    (ai.messages = ai.messages || []).push(msgBase('assistant', { read: false, content: '我刚刚发了一条动态：' + text }));
    touch(); if (sound()) playSfx('receive');
    return true;
  } catch { return false; }
}
export async function aiPostNow() {
  const all = personas();
  if (!all.length) return { ok: 0, fail: 0, none: true };
  let ok = 0, fail = 0;
  for (const ai of all.slice()) (await generateAiPost(ai)) ? ok++ : fail++;
  return { ok, fail };
}
let autoTimer = null;
export function syncAutoPost() {
  clearTimeout(autoTimer);
  if (!get('autoAiEnabled')) return;
  const loop = async () => {
    for (const ai of personas().slice()) if (Math.random() < 0.6) await generateAiPost(ai);
    autoTimer = setTimeout(loop, (30 + Math.random() * 30) * 60000);
  };
  autoTimer = setTimeout(loop, (30 + Math.random() * 30) * 60000);
}
export { sleep, emit };
