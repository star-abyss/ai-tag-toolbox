// 动作浏览器 · 页面。左栏列出宿主交来的全部动作，右边填参数、执行、原样看回执。
//
// 页面不认识任何模块：动作名、参数名、说明全部来自宿主。
// 参数值的读法只有一条：先按 JSON 解，解不出来就是字符串。

const 令牌 = window.__令牌__;
const 搜 = document.getElementById('搜');
const 列 = document.getElementById('列');
const 详 = document.getElementById('详');
const 数 = document.getElementById('数');
const 模型条 = document.getElementById('模型条');

/** 宿主交来的那张表。 */
let 桌 = { 动作表: [], 装不上: [], 项目根: '' };
/** 这次选中的那一条。 */
let 选中 = null;

/**
 * 发一次 POST。
 *
 * 动作那条路的失败信封（`{ ok:false, reason, code }`）**原样交回**，一个字不动：
 * 它就是要显示给人看的东西。动作表那条路出错才抛，因为那时候没有表可画。
 */
async function 请(路, 体) {
  const 答 = await fetch(路, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-toolbox-token': 令牌 },
    body: JSON.stringify(体 || {}),
  });
  const 回 = await 答.json();
  if (路 === '/toolbox/桌' && 回 && typeof 回 === 'object' && 回.ok === false) {
    throw new Error(`宿主说：${回.reason || '没给理由'}${回.code ? `（${回.code}）` : ''}`);
  }
  return 回;
}

/** `串?` → { 名:'串', 可选:true }。 */
function 读参数(一条) {
  return (一条.参数 || []).map((写出来的) => {
    const 可选 = 写出来的.endsWith('?');
    const 名 = 可选 ? 写出来的.slice(0, -1) : 写出来的;
    return { 名, 可选, 说明: (一条.说明 || {})[名] || '' };
  });
}

/**
 * 一个值是不是字节串。
 *
 * 宿主是 Node，它的 Buffer 过一趟 JSON 会变成 `{ type:'Buffer', data:[…] }`，数字键和 length 都没了。
 * 此外还认两种形态：`{ type:'Uint8Array', data:[…] }`，以及带 `length` 的数字键对象。
 */
function 是字节(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if ((v.type === 'Buffer' || v.type === 'Uint8Array') && Array.isArray(v.data)) return true;
  if (typeof v.length !== 'number' || typeof v.type !== 'string') return false;
  const 键 = Object.keys(v);
  if (!键.length || 键.length !== v.length) return false;
  return 键.every((k) => String(Number(k)) === k);
}

/** 取出字节的数组部分。 */
function 字节数(v) {
  return Array.isArray(v.data) ? v.data : v;
}

/** 字节串 → 能塞进 <img> 的地址。 */
function 成地址(字节, mime) {
  const 源 = 字节数(字节);
  const 数组 = new Uint8Array(源.length);
  for (let i = 0; i < 源.length; i += 1) 数组[i] = 源[i];
  return URL.createObjectURL(new Blob([数组], { type: mime || 'image/png' }));
}

/** 把回执里的字节串换成一句人话，其余原样。 */
function 换字节(v, 见到) {
  if (是字节(v)) { const 数 = 字节数(v); 见到.push(v); return `<原始字节：${数.length} 字节>（已从下面摘掉，看上面的预览）`; }
  if (Array.isArray(v)) return v.map((一) => 换字节(一, 见到));
  if (v && typeof v === 'object') {
    const 出 = {};
    for (const [k, 一] of Object.entries(v)) 出[k] = 换字节(一, 见到);
    return 出;
  }
  return v;
}

/** 参数框里的字 → 发给模块的值。解不出 JSON 就当字符串。 */
function 解值(字) {
  const 修 = 字.trim();
  if (!修) return undefined;
  try { return JSON.parse(修); } catch (_) { return 字.trim(); }
}

// ---------- 模型条 ----------

/** 一格的显示名：名字（id），装好了没有。 */
function 格的牌(一) {
  return `${一.名字}（${一.id}）${一.装好了 ? '' : ' · 缺东西'}`;
}

/** 画模型条。`模型` 是宿主交来的那一份（目录 + 每类几格 + 这次用哪个）。 */
function 画模型条(m) {
  if (!模型条) return;
  模型条.textContent = '';
  if (!m || (!m.vision.length && !m.translation.length)) {
    // 一格都没有也要说清：是目录空，还是压根没配目录。
    const 空 = document.createElement('span');
    空.className = '状态 坏';
    空.textContent = m && m.目录 ? `模型目录里一格都没有：${m.目录}` : '配置里没写「模型目录」';
    模型条.append(空);
    if (m && m.目录) {
      const 路 = document.createElement('span');
      路.className = '目录';
      路.textContent = m.目录;
      模型条.append(路);
    }
    return;
  }

  for (const [类别, 叫法] of [['vision', '识图模型'], ['translation', '翻译模型']]) {
    const 几格 = m[类别] || [];
    if (!几格.length) continue;

    const 一格 = document.createElement('div');
    一格.className = '一格';

    const 标 = document.createElement('span');
    标.className = '类';
    标.textContent = 叫法;

    const 选 = document.createElement('select');
    const 自动 = document.createElement('option');
    自动.value = '';
    自动.textContent = '（自动：第一格装好的）';
    选.append(自动);
    for (const 它 of 几格) {
      const 项 = document.createElement('option');
      项.value = 它.id;
      项.textContent = 格的牌(它);
      项.disabled = !它.装好了;
      if (它.这次用) 项.selected = true;
      选.append(项);
    }
    选.value = m.这次用[类别] || '';

    const 状 = document.createElement('span');
    状.className = '状态 好';
    状.textContent = `在用 ${m.这次用[类别] || '（没有）'}`;
    const 这次 = 几格.find((x) => x.这次用);
    if (!这次) {
      状.className = '状态 坏';
      状.textContent = '没有装好的';
    } else if (!这次.装好了) {
      状.className = '状态 坏';
      状.textContent = `缺：${这次.缺什么.join('；')}`;
    }

    选.addEventListener('change', async () => {
      状.className = '状态';
      状.textContent = '换着…';
      try {
        const 回 = await 请('/toolbox/模型', { 换: { 类别, id: 选.value } });
        if (回 && 回.ok === false) throw new Error(`${回.reason || '换不了'}${回.code ? `（${回.code}）` : ''}`);
        画模型条(回.data);
      } catch (错) {
        状.className = '状态 坏';
        状.textContent = String((错 && 错.message) || 错);
      }
    });

    一格.append(标, 选, 状);
    模型条.append(一格);
  }

  if (m.目录) {
    const 路 = document.createElement('span');
    路.className = '目录';
    路.textContent = m.目录;
    模型条.append(路);
  }
}

// ---------- 左栏 ----------

function 画列(过滤) {
  const 词 = String(过滤 || '').trim().toLowerCase();
  列.textContent = '';

  const 命中 = 桌.动作表.filter((一) => {
    if (!词) return true;
    const 料 = [一.模块, 一.动作, 一.摘要, ...(一.参数 || []), ...Object.values(一.说明 || {})].join(' ');
    return 料.toLowerCase().includes(词);
  });

  if (!命中.length) {
    const 空 = document.createElement('div');
    空.className = '空';
    空.textContent = 桌.动作表.length ? '没有对得上的动作。' : '宿主一个动作都没交来。';
    列.append(空);
  }

  let 上一个模块 = null;
  for (const 一 of 命中) {
    if (一.模块 !== 上一个模块) {
      上一个模块 = 一.模块;
      const 组 = document.createElement('div');
      组.className = '组';
      组.textContent = 一.模块;
      const 个数 = document.createElement('span');
      个数.className = '数';
      个数.textContent = `${命中.filter((x) => x.模块 === 一.模块).length}`;
      组.append(个数);
      列.append(组);
    }
    const 条 = document.createElement('div');
    条.className = '条';
    条.dataset.模块 = 一.模块;
    条.dataset.动作 = 一.动作;
    const 名 = document.createElement('div');
    名.className = '名';
    名.textContent = 一.动作;
    const 摘 = document.createElement('div');
    摘.className = '摘';
    摘.textContent = 一.摘要 || '';
    条.append(名, 摘);
    条.addEventListener('click', () => 选(一));
    列.append(条);
  }

  数.textContent = `${命中.length} / ${桌.动作表.length} 个动作`;
}

/** 标一下当前选中的那条。 */
function 标选(模块, 动作) {
  for (const 条 of 列.querySelectorAll('.条')) {
    条.classList.toggle('选', 条.dataset.模块 === 模块 && 条.dataset.动作 === 动作);
  }
}

// ---------- 右边 ----------

function 画详(一) {
  选中 = 一;
  详.textContent = '';

  const 名 = document.createElement('h2');
  名.textContent = 一.动作;
  const 谁 = document.createElement('div');
  谁.className = '模块名';
  谁.textContent = 一.模块;
  const 摘 = document.createElement('div');
  摘.className = '摘要';
  摘.textContent = 一.摘要 || '';
  详.append(名, 谁, 摘);

  const 参 = 读参数(一);
  const 框们 = new Map();

  if (!参.length) {
    const 空 = document.createElement('div');
    空.className = '说';
    空.style.color = 'var(--字淡)';
    空.style.fontSize = '12px';
    空.textContent = '这个动作不收参数。';
    详.append(空);
  }

  for (const 一个 of 参) {
    const 块 = document.createElement('div');
    块.className = '参';
    const 标 = document.createElement('label');
    标.textContent = 一个.名;
    if (一个.可选) {
      const 可 = document.createElement('span');
      可.className = '可选';
      可.textContent = '可选 · 留空就不传';
      标.append(可);
    }
    const 框 = document.createElement('textarea');
    框.rows = 1;
    框.spellcheck = false;
    if (一个.说明) {
      const 说 = document.createElement('p');
      说.className = '说';
      说.textContent = 一个.说明;
      块.append(标, 说, 框);
    } else {
      块.append(标, 框);
    }
    框们.set(一个.名, { 框, 可选: 一个.可选 });
    详.append(块);
  }

  const 行 = document.createElement('div');
  行.className = '行';
  const 钮 = document.createElement('button');
  钮.textContent = '执行';
  const 耗 = document.createElement('span');
  耗.className = '耗时';
  行.append(钮, 耗);
  详.append(行);

  const 放回执 = document.createElement('div');
  详.append(放回执);

  钮.addEventListener('click', () => 执行(一, 框们, 钮, 耗, 放回执));
}

async function 执行(一, 框们, 钮, 耗, 放回执) {
  const 参数 = {};
  for (const [名, { 框, 可选 }] of 框们) {
    const 值 = 解值(框.value);
    if (值 === undefined) {
      if (可选) continue;
      参数[名] = '';
      continue;
    }
    参数[名] = 值;
  }

  钮.disabled = true;
  钮.textContent = '跑着…';
  耗.textContent = '';
  const 起 = Date.now();
  const 滴 = setInterval(() => { 耗.textContent = `${((Date.now() - 起) / 1000).toFixed(1)} 秒`; }, 100);

  let 回;
  try {
    回 = await 请('/toolbox/调', { 模块: 一.模块, 动作: 一.动作, 参数 });
  } catch (错) {
    回 = { ok: false, reason: `请求没发出去：${String((错 && 错.message) || 错)}`, code: 'PAGE_FETCH' };
  } finally {
    clearInterval(滴);
    钮.disabled = false;
    钮.textContent = '执行';
  }

  耗.textContent = `${((Date.now() - 起) / 1000).toFixed(2)} 秒`;
  画回执(放回执, 回);
}

function 画回执(放, 回) {
  // 结果回来时，用户可能已经换了别的动作，那个容器就不在文档里了 —— 丢掉，不画给看不见的地方。
  if (!放 || !放.isConnected) return;
  放.textContent = '';

  const 失败 = 回 && typeof 回 === 'object' && 回.ok === false;
  const 盒 = document.createElement('div');
  盒.className = '回执';

  const 头 = document.createElement('div');
  头.className = '头';
  const 判 = document.createElement('span');
  判.className = `判 ${失败 ? '坏' : '好'}`;
  判.textContent = 失败 ? '失败' : '成功';
  头.append(判);
  if (失败 && 回.code) {
    const 码 = document.createElement('span');
    码.textContent = 回.code;
    头.append(码);
  }
  const 拷 = document.createElement('button');
  拷.className = '拷';
  拷.textContent = '复制回执';
  拷.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(回, null, 2)); 拷.textContent = '复制好了'; }
    catch (_) { 拷.textContent = '复制不了'; }
    setTimeout(() => { 拷.textContent = '复制回执'; }, 1200);
  });
  头.append(拷);
  盒.append(头);

  if (失败) {
    const 块 = document.createElement('div');
    块.className = '失败块';
    const 谁 = document.createElement('div');
    谁.className = '人话';
    谁.textContent = 回.reason || '模块没给理由';
    块.append(谁);
    if (回.code) {
      const 码 = document.createElement('div');
      码.className = '码';
      码.textContent = `码：${回.code}`;
      谁.before(码);
    }
    盒.append(块);
  }

  // 张图就预览：回执里带字节的那些（图片模块、识图模块、comfy 取图）。
  const 字节们 = [];
  const 干净 = 换字节(回 && 回.ok === false && 回.字节 ? { ...回, ok: false } : 回, 字节们);
  if (字节们.length) {
    const 块 = document.createElement('div');
    块.className = '预览';
    for (const 一个 of 字节们) {
      const 图 = document.createElement('img');
      图.src = 成地址(一个, 回 && 回.mime);
      图.alt = '回执里的字节';
      块.append(图);
    }
    const 说 = document.createElement('div');
    说.className = '说';
    说.textContent = `${字节们.length} 份原始字节，上面的预览就是它。`;
    块.append(说);
    盒.append(块);
  }

  const 文 = document.createElement('pre');
  文.textContent = JSON.stringify(干净 === undefined ? null : 干净, null, 2);
  盒.append(文);

  放.append(盒);
}

// ---------- 选 ----------

function 选(一) {
  画详(一);
  if (location.hash !== `#${encodeURIComponent(一.模块)}/${encodeURIComponent(一.动作)}`) {
    location.hash = `${encodeURIComponent(一.模块)}/${encodeURIComponent(一.动作)}`;
  }
  标选(一.模块, 一.动作);
}

/** 按 hash 挑一个（刷新后能回到原来那个动作）。已经是它就不动，免得白重建一遍。 */
function 按hash选() {
  const 原 = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  if (!原) return false;
  const [模块, 动作] = 原.split('/');
  if (选中 && 选中.模块 === 模块 && 选中.动作 === 动作) return true;
  const 一 = 桌.动作表.find((x) => x.模块 === 模块 && x.动作 === 动作);
  if (!一) return false;
  选(一);
  return true;
}

// ---------- 起 ----------

async function 起() {
  let 答;
  try {
    答 = await 请('/toolbox/桌', {});
  } catch (错) {
    列.textContent = '';
    const 坏 = document.createElement('div');
    坏.className = '空';
    坏.textContent = `拿不到动作表：${String((错 && 错.message) || 错)}`;
    列.append(坏);
    return;
  }

  桌 = 答;
  画列('');
  数.textContent = `${桌.动作表.length} 个动作`;
  画模型条(桌.模型);

  if (!按hash选()) {
    详.textContent = '';
    if (桌.装不上 && 桌.装不上.length) {
      const 警 = document.createElement('div');
      警.className = '警';
      警.textContent = `装不上的模块：${桌.装不上.map((x) => `${x.模块}（${x.理由}）`).join(' · ')}`;
      详.append(警);
    }
    const 空 = document.createElement('div');
    空.className = '空';
    空.textContent = '左边挑一个动作。每个参数写一行：直接写文字就是字符串，要对象或数组就写 JSON。';
    详.append(空);
  }
}

搜.addEventListener('input', () => 画列(搜.value));
搜.addEventListener('keydown', (e) => { if (e.key === 'Escape') { 搜.value = ''; 画列(''); } });
window.addEventListener('hashchange', 按hash选);

起();
