// DeepLine web — 我的 (profile + settings)
import { h } from './lib.js';
import { icon } from './icons.js';
import { S, get, set, save, touch, addMediaFromFile, exportBackup, importBackup, toast, flushSave } from './state.js';
import { playSfx } from './lib.js';
import { applyTheme, setting, chips, field, btn, pickFile, confirmDialog, mount } from './core.js';
import { avatarEl } from './core.js';
import { syncAutoPost } from './logic.js';

const quiet = (k, v) => { S.data[k] = v; save(); };

export function buildProfile() {
  const root = h('div', { class: 'pad', style: 'padding-top:0;gap:0' });
  const group = (title, ...kids) => h('div', { class: 'sgroup' }, h('h4', null, title), h('div', { class: 'glass s2' }, ...kids));
  const colorRow = (label, key, hint) => {
    const inp = h('input', { type: 'color', value: get(key) });
    inp.addEventListener('input', () => { quiet(key, inp.value.toUpperCase()); applyTheme(); });
    inp.addEventListener('change', () => touch());
    return h('div', { class: 'colorrow' }, h('span', null, label, hint ? h('div', { class: 'hint', style: 'margin:0' }, hint) : null), inp);
  };
  const slider = (label, key, min, max, step, fmt) => {
    const lab = h('b', { style: 'font-size:15px' }, label + ' ' + fmt(get(key)));
    const inp = h('input', { type: 'range', class: 'slider', min, max, step, value: get(key) });
    inp.addEventListener('input', () => { const v = Number(inp.value); quiet(key, v); lab.textContent = label + ' ' + fmt(v); applyTheme(); });
    inp.addEventListener('change', () => touch());
    return h('div', { style: 'padding:6px 0' }, lab, inp);
  };
  const text = (label, key, opts = {}) => {
    const el = opts.multiline ? h('textarea', { rows: 2 }) : h('input', { type: 'text', autocomplete: 'off' });
    el.value = get(key) || '';
    el.addEventListener('input', () => quiet(key, el.value));
    el.addEventListener('change', () => touch());
    return field(label, el);
  };

  root.append(
    group('个人资料',
      h('div', { style: 'display:flex;align-items:center;gap:12px;padding:6px 0' },
        h('button', { class: 'bounce', onClick: () => pickFile('image/*', async (f) => { try { set('myAvatar', await addMediaFromFile(f, 512)); mount(); } catch (e) { toast(e.message); } }) }, avatarEl(get('myAvatar'), get('myName'), 68)),
        h('div', null, h('b', { style: 'font-size:18px' }, get('myName')), h('div', { class: 'hint', style: 'margin:0' }, '点头像从相册更换'))),
      text('名字', 'myName'), text('简介', 'myBio', { multiline: true }), btn('保存资料', () => { touch(); toast('资料已保存'); }, 'primary', 'check')),
    group('外观',
      colorRow('主题颜色', 'theme'),
      setting('玻璃拟态 UI', '半透明卡片与柔和层次', get('glassUi'), (v) => { set('glassUi', v); }),
      slider('玻璃透明度', 'glassOpacity', 0.08, 0.85, 0.01, (v) => Math.round(v * 100) + '%'),
      setting('发送 / 接收音效', '轻柔提示音，可随时关闭', get('soundEnabled'), (v) => { set('soundEnabled', v); if (v) playSfx('receive'); })),
    group('聊天背景与气泡',
      btn('选择全局背景图', () => pickFile('image/*', async (f) => { try { set('background', await addMediaFromFile(f, 1600)); } catch (e) { toast(e.message); } }), '', 'image'),
      get('background') ? btn('恢复默认玻璃背景', () => set('background', ''), '', 'close') : null,
      slider('背景图变淡', 'backgroundAlpha', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'),
      slider('背景模糊', 'backgroundBlur', 0, 28, 1, (v) => String(v)),
      text('信息页标题', 'appTitle'), text('聊天输入框提示文字', 'inputHint'),
      h('b', { style: 'font-size:15px;display:block;margin-top:6px' }, '聊天外观（iMessage）'),
      chips(['自动', '浅色', '深色'], get('chatTheme'), (v) => set('chatTheme', v)),
      h('div', { class: 'hint' }, '自动：背景图较暗时使用深色 iMessage 外观'),
      colorRow('AI 气泡颜色', 'bubbleColor', '#FFFFFF = iMessage 自动灰'), colorRow('我的气泡颜色', 'myBubbleColor', '默认 iMessage 蓝'),
      colorRow('AI 消息文字颜色', 'aiTextColor', '默认自动'), colorRow('我的消息文字颜色', 'myTextColor', '默认白色'),
      btn(get('bubbleBackground') ? '更换气泡背景图' : '设置气泡背景图', () => pickFile('image/*', async (f) => { try { set('bubbleBackground', await addMediaFromFile(f, 600)); } catch (e) { toast(e.message); } }), '', 'image'),
      get('bubbleBackground') ? btn('移除气泡背景图', () => set('bubbleBackground', ''), '', 'close') : null),
    group('AI 行为',
      setting('深度思考', '让 AI 更谨慎地分析；DeepSeek 开启后可显示「思考摘要」', get('deepThinkingEnabled'), (v) => set('deepThinkingEnabled', v)),
      setting('每 50 条消息生成总结', '聊天页顶部显示「记忆自动总结已开启」，会额外调用一次 API', get('conversationSummaryEnabled'), (v) => set('conversationSummaryEnabled', v)),
      setting('允许 AI 自动发动态', '网页打开期间，AI 不定时发布动态并通知你；会消耗 API 额度', get('autoAiEnabled'), (v) => { set('autoAiEnabled', v); syncAutoPost(); }),
      setting('AI 自动点赞 / 评论', '你发布动态后，各 AI 按人设决定是否点赞或评论', get('aiMomentsEnabled'), (v) => set('aiMomentsEnabled', v)),
      setting('AI 随机多条回复', `开启后每次随机发送 1 至 ${get('multiReplyCount')} 条`, get('multiReplyEnabled'), (v) => set('multiReplyEnabled', v)),
      slider('单次最多回复数', 'multiReplyCount', 1, 4, 1, (v) => String(v)),
      slider('记忆参考消息数', 'memoryLimit', 5, 200, 1, (v) => String(v))),
    group('连接方式',
      h('div', { class: 'hint' }, 'API Key 只保存在这个浏览器里。默认通过本站服务器无状态转发到 AI 服务商（解决浏览器跨域限制，服务器不保存、不记录密钥和对话）。'),
      chips(['经服务器转发（推荐）', '浏览器直连'], get('directMode') ? '浏览器直连' : '经服务器转发（推荐）', (v) => set('directMode', v === '浏览器直连')),
      h('div', { class: 'hint' }, '直连时请求直接从浏览器发往服务商，需要对方允许跨域（Claude 使用官方的浏览器直连请求头；其他服务商可能被拦截）。')),
    group('数据与备份',
      h('div', { class: 'hint' }, '所有聊天、AI 设定和图片都保存在本浏览器（IndexedDB）。清除浏览器数据会丢失它们，请定期导出备份。备份 ZIP 与 Android 版互通。'),
      btn('导出完整数据 ZIP', async () => { try { await exportBackup(); } catch (e) { toast('导出失败：' + e.message); } }, '', 'folder'),
      btn('从 ZIP 恢复完整备份', () => pickFile('.zip,application/zip', async (f) => {
        if (!(await confirmDialog('恢复完整备份？', '这会用备份里的内容替换当前所有数据（AI、聊天、动态、设置）。', '恢复'))) return;
        try { toast(await importBackup(f, 'full')); syncAutoPost(); await flushSave(); mount(); } catch (e) { toast('恢复失败：' + e.message); }
      }), '', 'folder'),
      h('div', { class: 'hint' }, 'ZIP 备份包含 API Key 和聊天记录，请勿公开分享。')),
    h('div', { class: 'hint', style: 'text-align:center;margin:18px 0 6px' }, 'DeepLine Web 2.3.0')
  );
  return { el: root };
}
