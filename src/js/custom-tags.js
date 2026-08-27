'use strict';
/* ================= 自定义标签 ================= */
function renderCatOptions() {
  nCat.replaceChildren();
  for (const c of categories) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.icon + ' ' + c.name + (c.nsfw ? '（成人）' : '');
    nCat.appendChild(o);
  }
  const o = document.createElement('option');
  o.value = '__new__';
  o.textContent = '➕ 新建分类…';
  nCat.appendChild(o);
  nNewCatWrap.style.display = 'none';
}
function renderCustomList() {
  customList.replaceChildren();
  if (!customs.length) {
    customList.innerHTML = '<div class="empty" style="padding:12px 0">还没有自定义标签</div>';
    return;
  }
  for (const c of [...customs].reverse()) {
    const row = document.createElement('div');
    row.className = 'crow';
    row.innerHTML = '<span class="cen">' + esc(c.en) + '</span><span class="czh">' + esc(c.zh || '') + '</span>' +
      '<span class="cmeta">' + esc(c.cat) + ' / ' + esc(c.sub || '自定义') + '</span>' +
      '<button class="cdel" title="删除">✕</button>';
    row.querySelector('.cdel').onclick = () => {
      customs = customs.filter(x => normKey(x.en) !== normKey(c.en));
      persistCustoms(); rebuild(); render(); renderCustomList();
      toast('已删除自定义标签：' + c.en);
    };
    customList.appendChild(row);
  }
}
function openAdd() { renderCatOptions(); renderCustomList(); addModal.classList.add('show'); scrimEl.classList.add('show'); setTimeout(() => nEn.focus(), 200); }
function saveCustom() {
  const en = nEn.value.trim().replace(/,/g, ' ');
  if (!en) return toast('请填写英文标签名');
  const zh = nZh.value.trim();
  const al = nAl.value.trim().split(/\s+/).filter(Boolean).join(' ');
  let cat = nCat.value;
  const sub = nSub.value.trim() || '自定义';
  if (cat === '__new__') {
    const nc = nNewCat.value.trim();
    if (!nc) return toast('请填写新分类名称');
    const exist = categories.find(c => c.name === nc);
    cat = exist ? exist.id : nc;
  }
  if (!cat) return toast('请选择分类');
  const overrode = BASE_TAG_KEYS.has(normKey(en));
  customs = customs.filter(x => normKey(x.en) !== normKey(en));
  customs.push({ en, zh, al, cat, sub });
  persistCustoms(); rebuild(); render(); renderCustomList();
  nEn.value = ''; nZh.value = ''; nAl.value = ''; nSub.value = ''; nCat.value = categories[0].id; nNewCat.value = '';
  toast(overrode ? '已更新标签「' + en + '」（覆盖内置翻译/别名）' : '已添加标签：' + en);
}

