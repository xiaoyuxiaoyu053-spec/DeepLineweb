// DeepLine web — home shell and tabs: 信息 / 动态 / 增加AI / 我的
import { h, uid, listTime, relTime, readFileAsDataUrl } from './lib.js';
import { icon } from './icons.js';
import { S, get, set, touch, personas, groups, posts, findPersona, findPost, importBackup, addMediaFromFile, sound, toast } from './state.js';
import { playSfx } from './lib.js';
import { nav, go, registerView, avatarEl, badge, emptyState, switchEl, setting, press, menu, modal, confirmDialog, btn, pickFile, totalUnread, unreadOf, previewOf } from './core.js';
import { prependPost, reactToPost, replyToComment, aiPostNow, syncAutoPost } from './logic.js';
import { buildProfile } from './settings.js';

const TITLES = { chat: () => get('appTitle') || '信息', feed: () => '动态', add: () => '增加 AI', me: () => '我的' };

function homeView() {
  const header = h('div', { class: 'lt-header' });
  const content = h('div', { class: 'scroll' });
  const tabbar = h('div', { class: 'tabbar glass s2' });
  let tabView = null;
  const tabs = { chat: messagesTab, feed: feedTab, add: addTab, me: buildProfile };

  function drawHeader() {
    const left = nav.tab === 'chat'
      ? h('button', { class: 'link bounce', onClick: () => { nav.edit = !nav.edit; drawHeader(); tabView.update && tabView.update(); } }, nav.edit ? '完成' : '编辑')
      : h('button', { class: 'avatar-btn bounce', onClick: () => setTab('me') }, avatarEl(get('myAvatar'), get('myName'), 36));
    const right = nav.tab === 'chat'
      ? h('button', { class: 'circle-btn glass s2 bounce', 'aria-label': '新建信息', onClick: () => setTab('add') }, icon('edit', 21))
      : h('span');
    header.replaceChildren(h('div', { class: 'lt-top' }, left, right), h('h1', { class: 'lt-title' }, TITLES[nav.tab]()));
  }
  function drawTabbar() {
    const item = (id, label, ic) => {
      const n = id === 'chat' ? totalUnread() : 0;
      return h('button', { class: 'tab bounce' + (nav.tab === id ? ' on' : ''), onClick: () => setTab(id) }, icon(ic, 26), label, n ? h('span', { class: 'tb' }, n > 99 ? '99+' : String(n)) : null);
    };
    tabbar.replaceChildren(item('chat', '信息', 'chat'), item('feed', '动态', 'feed'), item('add', '增加AI', 'personAdd'), item('me', '我的', 'settings'));
  }
  function mountTab() {
    tabView = tabs[nav.tab]();
    tabView.el.classList.add('pop-in');
    content.replaceChildren(tabView.el);
    content.scrollTop = 0;
  }
  function setTab(t) { nav.tab = t; nav.edit = false; if (history.state) history.replaceState({ ...history.state, tab: t }, ''); mountTab(); drawHeader(); drawTabbar(); }
  drawHeader(); drawTabbar(); mountTab();
  return { el: h('div', { class: 'screen' }, header, content, tabbar), update() { drawHeader(); drawTabbar(); if (tabView && tabView.update) tabView.update(); } };
}
registerView('home', homeView);

const openChat = (id) => go('chat', { id });

// ───────────── 信息 list ─────────────
function messagesTab() {
  const searchInput = h('input', { type: 'search', placeholder: '搜索', value: nav.search, autocomplete: 'off', 'aria-label': '搜索' });
  const search = h('div', { class: 'search glass s2' }, icon('search', 20), searchInput, icon('mic', 20));
  const pillAll = h('button', { class: 'pill glass bounce' }, '所有信息');
  const pillGroup = h('button', { class: 'pill glass bounce' }, '群聊');
  const pills = h('div', { class: 'pills' }, pillAll, pillGroup);
  const area = h('div');
  const setMode = (m) => { nav.mode = m; fill(); };
  pillAll.addEventListener('click', () => setMode('私聊'));
  pillGroup.addEventListener('click', () => setMode('群聊'));
  searchInput.addEventListener('input', () => { nav.search = searchInput.value; fill(); });

  function personaRow(p) {
    const pv = previewOf(p.messages), unread = unreadOf(p);
    const gut = h('div', { class: 'gutter' });
    if (nav.edit) gut.append(h('button', { class: 'minus bounce', style: 'position:static', 'aria-label': '删除', onClick: (e) => { e.stopPropagation(); askDelete(p); } }, icon('minus', 16)));
    else if (unread) gut.append(h('i', { class: 'dot' }));
    const row = h('div', { class: 'row bounce soft' }, gut, avatarEl(p.avatar, p.name, 52),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, p.name), h('span', { class: 'row-time' }, listTime(pv.time)),
          nav.edit ? h('button', { class: 'bounce', style: 'margin-left:6px;color:' + (p.pinned ? 'var(--accent)' : 'var(--muted)'), 'aria-label': '置顶', onClick: (e) => { e.stopPropagation(); p.pinned = !p.pinned; touch(); } }, icon('pin', 20)) : icon('right', 16, 'chev')),
        h('div', { class: 'row-preview' }, pv.text || p.bio || p.persona || '')));
    press(row, { onTap: () => { if (!nav.edit) openChat(p.id); }, onLong: () => menu(row, [
      { label: '编辑 AI', onClick: () => go('editor', { id: p.id }) },
      { label: p.pinned ? '取消置顶' : '置顶 AI', onClick: () => { p.pinned = !p.pinned; touch(); } },
      { label: '删除 AI', danger: true, onClick: () => askDelete(p) }]) });
    return row;
  }
  async function askDelete(p) {
    if (await confirmDialog(`删除「${p.name}」？`, '与这个 AI 的聊天记录会一并删除，无法恢复。建议先在「我的」里导出备份。', '删除')) {
      S.data.personas = S.data.personas.filter((x) => x.id !== p.id); touch();
    }
  }
  function pinnedItem(p) {
    const unread = unreadOf(p);
    const el = h('div', { class: 'pin-item bounce' }, avatarEl(p.avatar, p.name, 78), h('span', { class: 'nm' }, p.name));
    if (unread && !nav.edit) { const b = badge(unread); b.style.cssText = 'top:-4px;left:calc(50% - 44px)'; el.append(b); }
    if (nav.edit) el.append(h('button', { class: 'minus bounce', style: 'top:-4px;right:calc(50% - 46px)', onClick: (e) => { e.stopPropagation(); askDelete(p); } }, icon('minus', 16)));
    press(el, { onTap: () => { if (nav.edit) { p.pinned = false; touch(); } else openChat(p.id); }, onLong: () => menu(el, [{ label: '取消置顶', onClick: () => { p.pinned = false; touch(); } }, { label: '删除 AI', danger: true, onClick: () => askDelete(p) }]) });
    return el;
  }
  function fill() {
    pillAll.classList.toggle('on', nav.mode !== '群聊'); pillGroup.classList.toggle('on', nav.mode === '群聊');
    const q = nav.search.trim().toLowerCase();
    if (nav.mode === '群聊') {
      const gs = groups();
      if (!gs.length) return area.replaceChildren(emptyState('还没有群聊', '到「增加AI」里创建群聊，把 AI 们拉进来'));
      return area.replaceChildren(h('div', { class: 'list-card glass s2' }, gs.map((g) => {
        const pv = previewOf(g.messages);
        const row = h('div', { class: 'row bounce soft' }, h('div', { class: 'gutter' }),
          h('div', { class: 'avatar', style: 'width:52px;height:52px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)' }, icon('groups', 28)),
          h('div', { class: 'row-main' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, g.name || '群聊'), h('span', { class: 'row-time' }, listTime(pv.time)), icon('right', 16, 'chev')),
            h('div', { class: 'row-preview' }, pv.text || `${(g.memberIds || []).length} 位 AI 成员`)));
        press(row, { onTap: () => go('groupChat', { id: g.id }) });
        return row;
      })));
    }
    const all = personas();
    const filtered = all.filter((p) => !q || [p.name, p.bio, p.persona].some((s) => (s || '').toLowerCase().includes(q)) || (p.messages || []).some((m) => (m.content || '').toLowerCase().includes(q)));
    if (!filtered.length) return area.replaceChildren(emptyState(all.length ? '没有找到' : '还没有信息', all.length ? '换个关键词试试' : '点右上角 ✎ 或「增加AI」创建第一个 AI'));
    const pinned = q ? [] : filtered.filter((p) => p.pinned);
    const rest = q ? filtered : filtered.filter((p) => !p.pinned);
    area.replaceChildren(pinned.length ? h('div', { class: 'pinned' }, pinned.map(pinnedItem)) : null, rest.length ? h('div', { class: 'list-card glass s2' }, rest.map(personaRow)) : null);
  }
  fill();
  return { el: h('div', null, search, pills, area), update: fill };
}

// ───────────── 动态 ─────────────
let feedText = '', feedImage = '', aiBusy = false;
function feedTab() {
  const root = h('div', { class: 'pad' });
  const coverEl = h('div'), ctrlEl = h('div'), postsEl = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const ta = h('textarea', { placeholder: '今天有什么新鲜事？', rows: 2 });
  ta.value = feedText;
  const imgPrev = h('div'), pubBtn = h('button', { class: 'btn primary inline bounce' }, icon('up', 16), '发布动态');
  const syncPub = () => { const ok = ta.value.trim() || feedImage; pubBtn.disabled = !ok; };
  ta.addEventListener('input', () => { feedText = ta.value; syncPub(); });
  const drawPrev = () => {
    imgPrev.replaceChildren(feedImage ? h('div', { style: 'position:relative;margin-top:8px' }, h('img', { src: S.media.get(feedImage.slice(6)) || '', style: 'width:100%;max-height:170px;object-fit:cover;border-radius:16px;display:block' }),
      h('button', { class: 'bounce', style: 'position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.4);color:#fff;display:grid;place-items:center', onClick: () => { feedImage = ''; drawPrev(); syncPub(); } }, icon('close', 16))) : null);
  };
  pubBtn.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text && !feedImage) return;
    const post = { id: uid(), time: Date.now(), author: get('myName'), avatar: get('myAvatar'), content: text, image: feedImage, likes: 0, likedBy: [], comments: [], ai: false };
    prependPost(post); feedText = ''; feedImage = ''; ta.value = ''; drawPrev(); syncPub(); touch();
    if (sound()) playSfx('success');
    reactToPost(post);
  });
  const composer = h('div', { class: 'card big glass s2 composer-card' },
    h('div', { style: 'display:flex;gap:10px;align-items:flex-start' }, avatarEl(get('myAvatar'), get('myName'), 42), h('div', { style: 'flex:1;padding-top:8px' }, ta)), imgPrev,
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:10px' },
      h('button', { class: 'btn inline bounce', style: 'background:rgba(0,0,0,.05);color:var(--muted)', onClick: () => pickFile('image/*', async (f) => { try { feedImage = await addMediaFromFile(f, 1280); drawPrev(); syncPub(); } catch (e) { toast(e.message); } }) }, icon('image', 18), '图片'), pubBtn));
  syncPub(); drawPrev();

  function drawCover() {
    const bg = h('div', { class: 'bg bounce soft', onClick: () => pickFile('image/*', async (f) => { try { set('momentsCover', await addMediaFromFile(f, 1400)); } catch (e) { toast(e.message); } }) }, h('span', { class: 'hint' }, '点击更换封面'));
    const url = S.media.get((get('momentsCover') || '').slice(6)); if (url) bg.style.backgroundImage = `url("${url}")`;
    coverEl.replaceChildren(h('div', { class: 'cover' }, bg, h('div', { class: 'who' }, avatarEl(get('myAvatar'), get('myName'), 74), h('div', { style: 'padding-bottom:2px' }, h('b', null, get('myName')), h('small', null, get('myBio') || '记录生活的每一刻')))));
  }
  function drawCtrl() {
    const runBtn = h('button', { class: 'btn inline bounce', disabled: aiBusy, onClick: async () => {
      aiBusy = true; drawCtrl();
      const r = await aiPostNow(); aiBusy = false; drawCtrl();
      toast(r.none ? '还没有 AI，先到「增加AI」创建一个。' : r.fail ? `成功 ${r.ok} 条，失败 ${r.fail} 条，请检查对应 AI 的 API Key` : `AI 已发布 ${r.ok} 条动态`);
    } }, icon('spark', 16), aiBusy ? 'AI 正在写…' : '让 AI 发一条');
    ctrlEl.replaceChildren(h('div', { class: 'card glass s2' },
      setting('AI 自动发动态', '网页打开期间，AI 会按人设不定时发布动态', get('autoAiEnabled'), (v) => { set('autoAiEnabled', v); syncAutoPost(); }),
      setting('AI 点赞 / 评论', '你发布动态后，AI 会按人设决定是否点赞、评论', get('aiMomentsEnabled'), (v) => set('aiMomentsEnabled', v)),
      h('div', { class: 'setting' }, h('div', { class: 't' }, h('small', null, '想马上看到效果？')), runBtn)));
  }
  function postCard(post) {
    const likedBy = post.likedBy || [], liked = likedBy.includes('me'), comments = post.comments || [];
    const more = h('button', { class: 'bounce', style: 'color:var(--muted)', onClick: (e) => menu(e.currentTarget, [{ label: '删除动态', danger: true, onClick: () => { S.data.posts = S.data.posts.filter((x) => x !== post); touch(); } }]) }, icon('more', 26));
    const like = h('button', { class: 'a bounce' + (liked ? ' liked' : ''), onClick: () => {
      if (liked) { post.likedBy = likedBy.filter((x) => x !== 'me'); post.likes = Math.max(0, (post.likes || 0) - 1); }
      else { (post.likedBy = likedBy).push('me'); post.likes = (post.likes || 0) + 1; if (sound()) playSfx('pop'); }
      touch();
    } }, icon(liked ? 'heart' : 'heartO', 21), String(post.likes || 0));
    return h('div', { class: 'card big glass s2 post pop-in' },
      h('div', { class: 'head' }, avatarEl(post.avatar, post.author, 42), h('div', { style: 'flex:1;min-width:0' }, h('div', null, h('b', null, post.author || get('myName')), post.ai ? h('span', { class: 'tag' }, 'AI') : null), h('small', null, relTime(post.time) || (post.ai ? 'AI 好友' : ''))), post.ai ? null : more),
      post.content ? h('p', { class: 'txt' }, post.content) : null,
      post.image && S.media.get(post.image.slice(6)) ? h('img', { class: 'pimg', src: S.media.get(post.image.slice(6)), alt: '动态图片' }) : null,
      h('div', { class: 'acts' }, like, h('button', { class: 'a bounce', onClick: () => openComments(post) }, icon('chat', 21), String(comments.length))),
      comments.length ? h('div', { class: 'comments' }, comments.slice(-3).map((c) => h('div', null, h('b', null, c.author), '：' + c.content)), comments.length > 3 ? h('button', { class: 'more', onClick: () => openComments(post) }, `查看全部 ${comments.length} 条评论`) : null) : null);
  }
  function drawPosts() {
    const ps = posts();
    postsEl.replaceChildren(...(ps.length ? ps.map(postCard) : [emptyState('还没有动态', '发布第一条动态，AI 好友会来点赞和评论')]));
  }
  drawCover(); drawCtrl(); drawPosts();
  root.append(coverEl, ctrlEl, composer, postsEl);
  return { el: root, update() { drawCover(); drawPosts(); } };
}
function openComments(post) {
  const list = h('div', { style: 'max-height:260px;overflow:auto;margin-bottom:8px' });
  const draw = () => list.replaceChildren(...((post.comments || []).length ? post.comments.map((c) => h('div', { style: 'display:flex;gap:8px;padding:4px 0' }, avatarEl(c.avatar, c.author, 34),
    h('div', { style: 'flex:1;background:#f3f5f9;border-radius:14px;padding:8px 10px' }, h('div', { style: 'font-size:12px;font-weight:600;color:var(--accent)' }, c.author), h('div', { style: 'font-size:14px' }, c.content),
      h('button', { style: 'font-size:12px;color:var(--accent);margin-top:2px', onClick: () => { ta.value = `回复 ${c.author}: `; ta.focus(); } }, '回复')))) : [h('p', null, '还没有评论，来说点什么吧。')]));
  const ta = h('textarea', { rows: 2, placeholder: '写下评论或回复…', style: 'width:100%;border:1px solid #dde3ea;border-radius:14px;padding:10px;font-size:15px;outline:0;resize:none' });
  draw();
  modal({ title: '评论与回复', body: [list, ta], actions: [{ label: '关闭' }, { label: '发送', kind: 'p', onClick: () => {
    const text = ta.value.trim(); if (!text) return false;
    (post.comments = post.comments || []).push({ id: uid(), author: get('myName'), avatar: get('myAvatar'), content: text, reply: '' });
    touch(); replyToComment(post, text);
  } }] });
}

// ───────────── 增加 AI ─────────────
function addTab() {
  const root = h('div', { class: 'pad' });
  const importAi = () => pickFile('.zip,application/zip', async (f) => { try { toast(await importBackup(f, 'personas')); } catch (e) { toast('导入失败：' + e.message); } });
  const big = (title, sub, ic, color, delay, fl, fn) => h('button', { class: 'bigcard glass s2 bounce pop-in', style: `animation-delay:${delay}ms`, onClick: fn },
    h('div', { class: 'float', style: `animation-duration:${fl}ms;display:flex;flex-direction:column;align-items:center` }, h('div', { class: 'ic', style: `background:${color}22;color:${color}` }, icon(ic, 32)), h('b', null, title), h('small', null, sub)));
  const listEl = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  const drawList = () => { const ps = personas(); listEl.replaceChildren(h('div', { class: 'secttl' }, `我的 AI 角色 · ${ps.length}`), ...(ps.length ? ps.map((p) => h('button', { class: 'pr glass s2 bounce soft', style: 'text-align:left;width:100%', onClick: () => openChat(p.id) }, avatarEl(p.avatar, p.name, 46), h('div', { style: 'flex:1;min-width:0' }, h('b', null, p.name), h('small', null, p.bio || p.persona || '')), h('span', { class: 'chip' }, p.provider || 'DeepSeek'))) : [emptyState('还没有 AI 角色', '点上面的卡片创建或导入')])); };
  drawList();
  root.append(h('div', { style: 'font-size:13px;color:var(--wall-muted);margin:0 4px' }, '导入已有角色，或亲手创建一个新的 AI 好友'),
    h('div', { class: 'bigcards' }, big('导入 AI', '从 ZIP 恢复角色、记录和 API 配置', 'folder', '#635bff', 0, 2300, importAi), big('创建 AI', '自定义名字、人设、服务商', 'spark', '#13a98b', 90, 2700, () => { if (personas().length >= 10) return toast('最多创建 10 个聊天对象'); go('editor', { id: '' }); })),
    h('button', { class: 'pr glass s2 bounce soft pop-in', style: 'text-align:left;width:100%;padding:16px;border-radius:26px;animation-delay:160ms', onClick: () => { if (!personas().length) return toast('请先创建至少一个 AI'); go('groupCreate'); } },
      h('div', { class: 'avatar', style: 'width:48px;height:48px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)' }, icon('groups', 26)),
      h('div', { style: 'flex:1' }, h('b', null, '创建群聊'), h('small', null, '选择已创建的 AI 一起聊天')), icon('right', 20)),
    listEl);
  return { el: root, update: drawList };
}
