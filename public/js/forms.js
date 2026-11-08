// DeepLine web — persona editor + group creation
import { h, uid } from './lib.js';
import { icon } from './icons.js';
import { S, get, touch, personas, groups, findPersona, addMediaFromFile, toast } from './state.js';
import { PROVIDERS, defaultModel } from './lib.js';
import { nav, go, goBack, registerView, avatarEl, field, chips, btn, pickFile } from './core.js';

const bar = (title) => h('div', { class: 'lt-header', style: 'display:flex;align-items:center;gap:12px;padding-bottom:8px' },
  h('button', { class: 'circle-btn glass s2 bounce', 'aria-label': '返回', onClick: () => goBack() }, icon('left', 24)),
  h('h2', { style: 'margin:0;font-size:20px;color:var(--wall-ink)' }, title));

function editorView() {
  const existing = nav.id ? findPersona(nav.id) : null;
  if (!existing && personas().length >= 10) { queueMicrotask(() => { toast('最多创建 10 个聊天对象'); go('home', {}, false); }); return { el: h('div') }; }
  const d = {
    name: existing ? existing.name : '', bio: existing ? existing.bio || '' : '', persona: existing ? existing.persona || '' : '',
    provider: existing ? existing.provider || 'DeepSeek' : 'DeepSeek', model: existing ? existing.model || defaultModel(existing.provider || 'DeepSeek') : defaultModel('DeepSeek'),
    apiKey: '', gender: existing ? existing.gender || '其他' : '其他', relation: existing ? existing.relationship || '朋友' : '朋友',
    likes: existing ? existing.likes || '' : '', dislikes: existing ? existing.dislikes || '' : '', hobbies: existing ? existing.hobbies || '' : '', avatar: existing ? existing.avatar || '' : '',
  };
  const input = (key, type = 'text') => { const el = h('input', { type, autocomplete: 'off', value: d[key] }); el.addEventListener('input', () => { d[key] = el.value; }); return el; };
  const area = (key, rows) => { const el = h('textarea', { rows }); el.value = d[key]; el.addEventListener('input', () => { d[key] = el.value; }); return el; };
  const avatarBox = h('div');
  const drawAvatar = () => avatarBox.replaceChildren(h('button', { class: 'bounce', onClick: pick }, avatarEl(d.avatar, d.name, 72)));
  const pick = () => pickFile('image/*', async (f) => { try { d.avatar = await addMediaFromFile(f, 512); drawAvatar(); } catch (e) { toast(e.message); } });
  const modelEl = input('model'), hintEl = h('div', { class: 'hint' });
  const drawHint = () => { hintEl.textContent = `默认模型：${defaultModel(d.provider)}。豆包需使用控制台中实际可用的模型或接入点 ID。`; };
  const relInput = input('relation');
  const err = h('div', { style: 'color:#d14343;font-size:14px;margin-top:8px' });
  const keyEl = input('apiKey', 'password'); keyEl.placeholder = existing ? '留空保持原密钥' : '';
  const card = h('div', { class: 'card big glass s2' },
    h('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:6px' }, avatarBox, btn('从相册选择头像', pick, '', 'image')),
    field('名字 *', input('name')), field('简介', area('bio', 2)), field('人设 *', area('persona', 3)),
    h('b', { style: 'display:block;margin-top:10px' }, 'AI 服务商'),
    chips(PROVIDERS, d.provider, (v) => { if (v !== d.provider) { d.apiKey = ''; keyEl.value = ''; } d.provider = v; d.model = defaultModel(v); modelEl.value = d.model; drawHint(); }),
    field('模型名称 / 豆包接入点 ID', modelEl), hintEl,
    field(existing ? `更新 API Key（留空保持原密钥）` : 'API Key *', keyEl),
    h('div', { class: 'hint' }, existing ? '编辑资料不会删除现有聊天记录。API Key 留空会保留原密钥。' : '必须填写可用的 API Key 才能创建此 AI。费用和额度由 API 服务商决定；密钥只保存在本浏览器。'),
    h('b', { style: 'display:block;margin-top:10px' }, '性别'), chips(['男', '女', '其他'], d.gender, (v) => { d.gender = v; }),
    h('b', { style: 'display:block;margin-top:10px' }, '与你的关系'), chips(['家人', '情侣', '哥哥', '弟弟', '朋友', '亲戚'], d.relation, (v) => { d.relation = v; relInput.value = v; }),
    field('自定义关系（可直接输入）', relInput),
    h('b', { style: 'display:block;margin-top:14px' }, '选填：角色偏好'), field('喜欢什么', area('likes', 2)), field('讨厌什么', area('dislikes', 2)), field('爱好', area('hobbies', 2)), err);
  drawAvatar(); drawHint();
  const save = btn(existing ? '保存修改' : '创建 AI', () => {
    const name = d.name.trim(), persona = d.persona.trim(), key = d.apiKey.trim();
    if (!name) return (err.textContent = '请填写名字');
    if (!persona) return (err.textContent = '请填写人设');
    if (!existing && !key) return (err.textContent = '请填写 API Key');
    if (existing) {
      Object.assign(existing, { name, bio: d.bio.trim(), persona, gender: d.gender, relationship: d.relation.trim() || '朋友', likes: d.likes, dislikes: d.dislikes, hobbies: d.hobbies, avatar: d.avatar, provider: d.provider, model: d.model.trim() || defaultModel(d.provider) });
      if (key) existing.apiKey = key;
    } else {
      personas().push({ id: String(Date.now()), name, bio: d.bio.trim(), persona, gender: d.gender, relationship: d.relation.trim() || '朋友', likes: d.likes, dislikes: d.dislikes, hobbies: d.hobbies, avatar: d.avatar, provider: d.provider, model: d.model.trim() || defaultModel(d.provider), apiKey: key, messages: [] });
    }
    touch(); toast(existing ? '已保存' : `已创建「${name}」`); goBack();
  }, 'primary');
  save.style.margin = '12px 0';
  return { el: h('div', { class: 'screen' }, bar(existing ? '编辑 AI 人设' : '创建 AI 人设'), h('div', { class: 'scroll' }, h('div', { class: 'pad' }, card, save))) };
}
registerView('editor', editorView);

function groupCreateView() {
  let name = '', selected = new Set();
  const nameEl = h('input', { type: 'text', placeholder: '群聊名称', autocomplete: 'off' });
  nameEl.addEventListener('input', () => { name = nameEl.value; });
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const draw = () => list.replaceChildren(...personas().map((p) => h('button', { class: 'pr glass s2 bounce soft', style: 'text-align:left;width:100%', onClick: () => { if (selected.has(p.id)) selected.delete(p.id); else if (selected.size < 8) selected.add(p.id); draw(); createBtn.firstChild && (createBtn.lastChild.textContent = `创建群聊 · ${selected.size} 个 AI`); } },
    avatarEl(p.avatar, p.name, 46), h('div', { style: 'flex:1;min-width:0' }, h('b', null, p.name), h('small', null, p.persona || '')), h('span', { class: 'switch' + (selected.has(p.id) ? ' on' : ''), style: 'pointer-events:none' }))));
  const createBtn = btn('创建群聊 · 0 个 AI', () => {
    if (!name.trim() || !selected.size) return toast('请填写群聊名称，并至少选择一个 AI');
    groups().push({ id: uid(), name: name.trim(), memberIds: [...selected], messages: [] });
    touch(); nav.tab = 'chat'; nav.mode = '群聊'; nav.keepTab = true; goBack();
  }, 'primary');
  draw();
  return { el: h('div', { class: 'screen' }, bar('创建群聊'), h('div', { class: 'scroll' }, h('div', { class: 'pad' }, field('群聊名称', nameEl), h('div', { class: 'secttl' }, '选择你创建的 AI（每人每轮最多回复一次，最多 8 个）'), list, createBtn))) };
}
registerView('groupCreate', groupCreateView);
