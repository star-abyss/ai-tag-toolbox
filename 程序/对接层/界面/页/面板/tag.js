// 标签面板：一个选择器 —— 左边分类栏，中间卡片墙，底下已选栏。
//
// 六路取数，都走模块自己的动作：全部（照分类往下挖）· 查库（query）· 位置（position.*）
// · 隐藏库（hidden.list）· 改过的（modified.list）。
//
// 这一块要调哪几个动作写死在下面的调用处——**动作名之外的任何东西都从宿主读**：
// 参数名、可选、说明、控件形状、按钮文案（各动作自己那句摘要）。
// 一条记录长什么样（名称 / 中文名 / 成员 / 成人 / 回显）是标签模块的回执形状，
// 界面照它画，不自己造字段。
//
// 类名一律取 `../组件.md` 里列过的；长相住在 `页/页.css` 与 `页/组件.css`。
import { 造, 清, 画回执, 一个动作钮, 画一个参数, 分段, 吐司, 要人填, 说秒 } from '../顺手.js';

const 模块 = 'tag';

/** 按钮上写什么：用那个动作自己的摘要（摘要的写法是「一句话：细说」，取冒号前那半）。 */
function 钮话(宿主, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

/** 一条记录的中文名：逗号分隔，第一个是主名。 */
function 中文名们(记录) {
  return String(记录.中文名 || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 一条记录的主中文名（没有就空串）。 */
function 主中文名(记录) {
  return 中文名们(记录)[0] || '';
}

/** 配色里的底色调成卡片左边那条竖线。 */
function 边色(配色) {
  return (配色 && 配色.background) || 'var(--线亮)';
}

/** 一次画多少张卡：分类里几千条，一次全画会把页面拖死。 */
const 一批 = 240;

export default function 造标签面板({ 宿主, 模子 }) {
  return {
    名: 'tag',
    标题: '标签',
    副题: '词的库与检索 · 一个词两种写法归一成一个比对键',
    要的模块: [模块],

    画(墙) {      const 状态 = {
        路: '全部',
        选中: new Map(),      // 记录ID → 记录
        页: null,             // 现在看的分类页
        类: null,             // 现在看的类
        全部名单: [],         // 「全部」这一路：当前类的成员，一次要回来的
        画到: 0,
        位置树: null,         // 分类页们（带配色与类列表）
        代数: 0,              // 每换一次路加一：老那一趟回来时照着它认出自己过期了
      };

      /** 现在这一趟还是不是最新的那一趟。取数回来先问一句，过期的就不要再往页面上写了。 */
      function 还作数(这一趟) { return 这一趟 === 状态.代数; }

      // ---------- 顶条 ----------

      const 顶 = 造('div.墙顶');
      const 搜 = 造('input', {
        type: 'search',
        placeholder: '敲一个词：miku · 1girl · 风景',
        autocomplete: 'off',
      });
      const 搜数 = 造('span.数');
      const 搜框 = 造('div.搜框', 造('span.镜', '⌕'), 搜, 搜数);
      const 视图 = 分段(
        [{ 值: '全部' }, { 值: '查库' }, { 值: '分类' }, { 值: '收藏' }, { 值: '隐藏库' }, { 值: '改过的' }],
        '全部',
        (值) => 换路(值),
      );
      const 重来 = 造('button.钮.幽灵', { title: '重新读一遍这一路' }, '重读');
      顶.append(造('div.横排', 视图.元, 造('span.伸'), 重来), 搜框);

      // ---------- 身子：左分类栏 + 右卡片 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏', 左, 右));
      身.style.display = 'flex';

      // ---------- 底栏 ----------

      const 底 = 造('div.墙底');
      const 底数 = 造('span.数');
      const 复制 = 造('button.钮', '复制');
      const 存藏 = 造('button.钮', '存进收藏');
      const 清空 = 造('button.钮.幽灵', '清空');
      底.append(底数, 造('span.伸'), 清空, 存藏, 复制);

      墙.append(顶, 身, 底);

      /** 一条记录里名字那半（逗号分隔，第一个是规范写法）。 */
      function 名称们(记录) {
        return String(记录.名称 || '').split(',').map((s) => s.trim()).filter(Boolean);
      }

      /**
       * 把已选的那几个拼成一段文本：一行全名 + 一行中文名。
       * 词序由模块的「渲染顺序」给（作品 → 发色 → 其他外貌 → 服装……），不是点选的先后。
       */
      async function 拼已选() {
        const 们 = [...状态.选中.values()];
        const 标 = 们.map((r) => String(r.ID));
        const { 回 } = await 宿主.调(模块, 'render.sort', { 词们: 标 });
        const 排好 = Array.isArray(回) ? 回.filter((一) => 一.在库里 !== false) : null;
        if (!排好) {
          // 模块没回话就按点选的先后拼（不阻塞复制这件事）
          return [们.map((r) => 名称们(r)[0]).filter(Boolean).join(', '),
            们.map((r) => 主中文名(r)).filter(Boolean).join(', ')].filter(Boolean).join('\n');
        }
        const 词 = 排好.map((一) => 一.词).filter(Boolean);
        const 译 = 排好.map((一) => 一.中文名).filter(Boolean);
        return [词.join(', '), 译.join(', ')].filter(Boolean).join('\n');
      }

      /** 底栏跟着已选重画。 */
      function 画底() {
        const 几个 = 状态.选中.size;
        底数.textContent = 几个 ? `已选 ${几个} 个` : '一个都没选';
        复制.disabled = !几个;
        存藏.disabled = !几个;
        清空.disabled = !几个;
      }

      /** 点一下卡片：选中／取消。 */
      function 点卡片(记录) {
        const 键 = String(记录.ID);
        if (状态.选中.has(键)) 状态.选中.delete(键);
        else 状态.选中.set(键, 记录);
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) {
          卡.setAttribute('aria-selected', String(状态.选中.has(String(卡.dataset.标识))));
        }
      }

      /**
       * 造一张卡片。
       * @param {object} 记录 模块给的那一条
       * @param {object} [选项] 哪一档=顶上那行小字 · 配色=左边竖线与角标 · 位置={页,类}
       */
      function 一张卡(记录, 选项 = {}) {
        const 卡 = 造('div.卡片', {
          dataset: { 标识: String(记录.ID) },
          style: { borderLeftColor: 边色(选项.配色) },
        });
        const 名行 = 造('div.横排', { style: { gap: '6px', flexWrap: 'nowrap' } });
        名行.append(造('span.名', { style: { flex: '1' } }, 名称们(记录)[0] || '（没名字）'));
        卡.append(名行);
        const 译 = 主中文名(记录);
        卡.append(造('div.译', 译 || '（还没有中文名）'));
        const 底行 = 造('div.底行');
        if (选项.哪一档) 底行.append(造('span.标签', 选项.哪一档));
        if (记录.成员) 底行.append(造('span.标签.主', 记录.成员.length ? `组 ${记录.成员.length}` : '空组'));
        if (记录.成人) 底行.append(造('span.标签.警', '成人'));
        if (记录.回显 === false) 底行.append(造('span.标签', '不检索'));
        if (底行.children.length) 卡.append(底行);

        // 角上那三个：只在 hover 或选中时露出来（`.卡片 .角` 管这个）。
        const 角 = 造('div.角');
        const 拷 = 造('button.钮.小.幽灵', { type: 'button', title: '复制这个标签' }, '复');
        拷.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(名称们(记录)[0] || '');
            吐司(`复制了 ${名称们(记录)[0]}`, '成', 1400);
          } catch (_) { 吐司('复制不了', '错'); }
        });
        const 详 = 造('button.钮.小.幽灵', { type: 'button', title: '看这一条的详情' }, '详');
        详.addEventListener('click', (e) => { e.stopPropagation(); 开详情(记录, 选项.位置); });
        角.append(拷, 详);
        卡.append(角);

        卡.setAttribute('aria-selected', String(状态.选中.has(String(记录.ID))));
        卡.addEventListener('click', () => 点卡片(记录));
        return 卡;
      }

      /** 画一批卡片进一个容器。 */
      function 画卡们(容器, 记录们, 选项 = {}) {
        const 格 = 造('div.卡片们.标签墙');
        容器.append(格);
        for (const 一 of 记录们) 格.append(一张卡(一, typeof 选项 === 'function' ? 选项(一) : 选项));
        return 格;
      }

      // ---------- 取数 ----------

      /** 调一次，把回执画进一个容器。 */
      async function 调并画(动作, 参数, 放) {
        const { 回, 耗时 } = await 宿主.调(模块, 动作, 参数);
        清(放).append(画回执({ 回, 耗时, 模子 }));
        return 回;
      }

      /** 要一份名单（隐藏库 / 改过的 / 查库的候选）。回执不像名单时把回执画出来。 */
      function 名单出(回, 放) {
        if (回 && 回.ok === false) { 清(放).append(画回执({ 回, 模子 })); return null; }
        if (!Array.isArray(回)) { 清(放).append(画回执({ 回, 模子 })); return null; }
        return 回;
      }

      // ---------- 左边：分类栏 ----------

      /** 读分类树。分类页与类都带配色，卡片左边那条竖线就是它。 */
      async function 读分类树(重读 = false) {
        if (状态.位置树 && !重读) return 状态.位置树;
        清(左).append(造('div.栏头', 造('h2', '分类')));
        左.append(造('div.装填', '读着…'));
        const { 回 } = await 宿主.调(模块, 'position.list', { 位置: '分类' });
        清(左);
        左.append(造('div.栏头', 造('h2', '分类'), 造('span.伸'), 造('span.数', '各页累计')));
        if (!回 || 回.ok === false) {
          左.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 模子 }));
          return null;
        }
        状态.位置树 = Array.isArray(回) ? 回 : [];
        const 栏 = 造('div.类栏');
        栏.append(左下项('全部', null, null));
        for (const 页 of 状态.位置树) {
          栏.append(左下项(页.页名, 页, null));
          for (const 类 of 页.类列表 || []) 栏.append(左下项(类.类名, 页, 类));
        }
        左.append(栏);
        return 状态.位置树;
      }

      /** 分类栏里的一项。 */
      function 左下项(话, 页, 类) {
        const 项 = 造('button.类项', { type: 'button' });
        if (页) 项.append(造('span.点', { style: { background: 边色(页.配色) } }));
        项.append(造('span.名', 类 ? `　${话}` : 话));
        if (!类) 项.append(造('span.数', 页 ? `${(页.类列表 || []).length} 类` : ''));
        项.addEventListener('click', () => 挖进(页, 类));
        if (页 && !类) 项.style.fontWeight = '600';
        return 项;
      }

      /** 点分类栏：把那一页/类的成员捞回来画成卡片。 */
      async function 挖进(页, 类) {
        const 这一趟 = 状态.代数;
        状态.页 = 页;
        状态.类 = 类;
        状态.全部名单 = [];
        状态.画到 = 0;
        清(右);
        if (!页) { 右.append(造('div.装填', '读着…')); await 读全部(); return; }
        if (!类) { 画一类的头(页, null); return; }

        画一类的头(页, 类);
        const 装 = 造('div', 造('div.装填', `读着 ${页.页名} / ${类.类名}…`));
        右.append(装);
        const { 回, 耗时 } = await 宿主.调(模块, 'position.members', { 位置: '分类', 页: 页.ID, 类: 类.ID });
        if (!还作数(这一趟)) return;
        清(装);
        if (!回 || 回.ok === false) {
          装.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        状态.全部名单 = 回 || [];
        if (!状态.全部名单.length) { 装.append(造('div.空', '这一类里一个词都没有。')); return; }
        装.append(造('div.细节', { style: { marginBottom: '8px' } },
          `这一类推 ${状态.全部名单.length} 个 · 用时 ${说秒(耗时)}`));
        const 出 = 造('div');
        装.append(出);
        续一批(出, 页.配色, { 页, 类 }, 这一趟);
      }

      /** 一栏的头：这一路是什么、有多少。 */
      function 画一类的头(页, 类) {
        const 头 = 造('div.栏头',
          造('h2', 类 ? `${页.页名} / ${类.类名}` : 页.页名),
          造('span.伸'),
          造('span.数', 类 ? '' : '挑一个类'));
        if (类) 头.append(造('span.标签', { style: { background: 边色(类.配色 || 页.配色), color: (类.配色 || 页.配色 || {}).foreground || '#fff' } }, '配色来自模块'));
        右.append(头);
      }

      /** 把「全部名单」再画一批出去；底下留一个"再显示 N 个"。 */
      function 续一批(容器, 配色, 位置, 这一趟) {
        const 从 = 状态.画到;
        const 到 = Math.min(从 + 一批, 状态.全部名单.length);
        const 这一批 = 状态.全部名单.slice(从, 到);
        清(容器);
        const 格 = 造('div.卡片们.标签墙');
        容器.append(
          造('div.细节', { style: { marginBottom: '8px' } }, `显示 ${到} / ${状态.全部名单.length}`),
          格,
        );
        格.append(造('div.装填', '取这几条…'));
        宿主.调(模块, 'record.batch', { 标识列表: 这一批 }).then(({ 回 }) => {
          if (!还作数(这一趟)) return;
          清(格);
          if (!回 || 回.ok === false) {
            格.append(造('div.提示.错', `取不出来：${(回 && 回.reason) || '没回话'}`));
            return;
          }
          const 拿到 = Array.isArray(回) ? 回 : [];
          // 位置格里可能留着已经被删掉的 ID（模块的规矩：渲染时取不到就跳过）。
          for (const 一 of 拿到) 格.append(一张卡(一, { 配色, 位置 }));
          状态.画到 = 到;
          if (到 < 状态.全部名单.length) {
            const 再 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '10px' } },
              `再显示 ${Math.min(一批, 状态.全部名单.length - 到)} 个（还有 ${状态.全部名单.length - 到} 个）`);
            再.addEventListener('click', () => 续一批(容器, 配色, 位置, 这一趟));
            容器.append(再);
          }
        });
      }

      // ---------- 全部这一路 ----------

      async function 读全部() {
        const 这一趟 = 状态.代数;
        清(右);
        右.append(造('div.栏头', 造('h2', '全部'), 造('span.伸'), 造('span.数', '按分类挖')));
        const 树 = await 读分类树();
        if (!还作数(这一趟)) return;
        if (!树) return;
        if (!树.length) { 右.append(造('div.空', '分类是空的。')); return; }
        右.append(造('div.提示.淡',
          '左边挑一页或一个类，这里就把它底下的词铺成卡片。分类与配色都是模块给的。'));
        const 第一页 = 树[0];
        const 第一类 = (第一页.类列表 || [])[0];
        if (第一类) await 挖进(第一页, 第一类);
      }

      // ---------- 查库这一路 ----------

      async function 查库(上限) {
        const 这一趟 = 状态.代数;
        const 串value = 搜.value.trim();
        清(右);
        右.append(造('div.栏头', 造('h2', '查库'), 造('span.伸'), 搜数));
        if (!串value) { 右.append(造('div.空', '左上角敲一个词再查。')); return; }
        const 要 = { 串: 串value };
        if (上限) 要.上限 = 上限;
        const 装 = 造('div', 造('div.装填', '查着…'));
        右.append(装);
        const { 回, 耗时 } = await 宿主.调(模块, 'query', 要);
        if (!还作数(这一趟)) return;
        清(装);
        if (!回 || 回.ok === false) {
          装.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        const 候选 = 回.候选 || [];
        搜数.textContent = `命中 ${回.合计}${回.还有更多 ? '+' : ''} · 给 ${候选.length} 条 · ${说秒(耗时)}`;
        装.append(造('div.栏头', 造('span.数', `命中合计 ${回.合计}${回.还有更多 ? '（还有更多）' : ''}`)));
        if (!候选.length) { 装.append(造('div.空', '没有对得上的词。')); return; }
        const 格 = 造('div.卡片们.标签墙');
        装.append(格);
        for (const 一 of 候选) {
          // 两种候选并列：一条记录（能选进提示词）与一个类（点开 = 那个类里的东西）
          if (一.类型 === '类') 格.append(一张类卡(一.类, 一.档));
          else 格.append(一张卡(一.记录, { 哪一档: `档 ${一.档} · ${一.命中}` }));
        }
        if (回.还有更多) {
          const 下一个 = Math.max(30, 候选.length) * 2;
          const 再 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '10px' } }, `再要 ${下一个} 条`);
          再.addEventListener('click', () => 查库(下一个));
          装.append(再);
        }
      }

      /**
       * 造一张**类**卡片：点开 = 把那个类底下的东西铺出来。
       * 类不是记录：没有中文名、不能插进提示词，它只有"点开"这一件事。
       */
      function 一张类卡(类, 档) {
        const 卡 = 造('div.卡片', { dataset: { 标识: `类-${类.页ID}-${类.ID}`, 类卡: '1' } });
        卡.append(造('div.横排', 造('span.名', { style: { flex: '1' } }, 类.类名)));
        卡.append(造('div.译', `类 · ${类.页名}`));
        卡.append(造('div.底行', 造('span.标签.主', `档 ${档}`), 造('span.标签', '点开列成员')));
        卡.addEventListener('click', () => 铺一类(类));
        return 卡;
      }

      /** 把一个类（从搜索结果点进来的）铺成卡片墙。 */
      async function 铺一类(类) {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.页 = { ID: 类.页ID, 页名: 类.页名 };
        状态.类 = { ID: 类.ID, 类名: 类.类名 };
        状态.全部名单 = [];
        状态.画到 = 0;
        清(右);
        const 头 = 造('div.栏头',
          造('h2', `${类.页名} / ${类.类名}`),
          造('span.伸'),
          造('span.标签', '从搜索点开的类'));
        右.append(头);
        const 装 = 造('div', 造('div.装填', `读着 ${类.页名} / ${类.类名}…`));
        右.append(装);
        const { 回, 耗时 } = await 宿主.调(模块, 'position.members', { 位置: '分类', 页: 类.页ID, 类: 类.ID });
        if (!还作数(这一趟)) return;
        清(装);
        if (!回 || 回.ok === false) {
          装.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        状态.全部名单 = Array.isArray(回) ? 回 : [];
        if (!状态.全部名单.length) { 装.append(造('div.空', '这一类里一个词都没有。')); return; }
        装.append(造('div.细节', { style: { marginBottom: '8px' } },
          `这一类推 ${状态.全部名单.length} 个 · 用时 ${说秒(耗时)}`));
        const 出 = 造('div');
        装.append(出);
        续一批(出, undefined, { 页: 状态.页, 类: 状态.类 }, 这一趟);
      }

      // ---------- 位置：收藏 ----------

      async function 读收藏() {
        清(右);
        右.append(造('div.栏头', 造('h2', '收藏'), 造('span.伸')));
        const { 回 } = await 宿主.调(模块, 'position.list', { 位置: '收藏' });
        if (!回 || 回.ok === false) {
          右.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 模子 }));
          return;
        }
        const 页们 = Array.isArray(回) ? 回 : [];
        if (!页们.length) {
          右.append(造('div.提示.警', '收藏里一页都没有。先建一页一个类，才存得进东西。'));
          return;
        }
        for (const 页 of 页们) {
          右.append(造('div.块', { style: { marginBottom: '10px' } },
            造('div.栏头', 造('h3', 页.页名), 造('span.伸'), 造('span.数', `${(页.类列表 || []).length} 类`))));
          const 块 = 右.children[右.children.length - 1];
          for (const 类 of 页.类列表 || []) {
            const 行 = 造('div.条');
            行.append(造('span.点', { style: { width: '8px', height: '8px', borderRadius: '2px', background: 边色(类.配色 || 页.配色) } }));
            行.append(造('span.名', 类.类名));
            const 看 = 造('button.钮.小', { type: 'button' }, '看里面');
            看.addEventListener('click', () => 看收藏类(页, 类));
            行.append(看);
            块.append(行);
          }
        }
        const 装 = 造('div', { style: { marginTop: '12px' } });
        右.append(装);
        状态.收藏放 = 装;
      }

      /** 看收藏里某个类的东西。 */
      async function 看收藏类(页, 类) {
        const 这一趟 = 状态.代数;
        const 放 = 状态.收藏放;
        清(放).append(造('div.装填', '读着…'));
        const { 回 } = await 宿主.调(模块, 'position.members', { 位置: '收藏', 页: 页.ID, 类: 类.ID });
        if (!还作数(这一趟)) return;
        清(放);
        if (!回 || 回.ok === false) { 放.append(造('div.提示.错', (回 && 回.reason) || '没回话')); return; }
        const 名单 = Array.isArray(回) ? 回 : [];
        放.append(造('div.栏头', 造('h3', `${页.页名} / ${类.类名}`), 造('span.伸'), 造('span.数', `${名单.length} 个`)));
        if (!名单.length) { 放.append(造('div.空', '这一类是空的。')); return; }
        const { 回: 记 } = await 宿主.调(模块, 'record.batch', { 标识列表: 名单.slice(0, 一批) });
        if (!还作数(这一趟)) return;
        if (记 && 记.ok !== false && Array.isArray(记)) 画卡们(放, 记, { 配色: 类.配色 || 页.配色, 位置: { 页, 类 } });
        else 放.append(画回执({ 回: 记, 模子 }));
      }

      // ---------- 名单那两路 ----------

      async function 读名单(动作, 空话) {
        const 这一趟 = 状态.代数;
        清(右);
        右.append(造('div.栏头', 造('h2', 动作 === 'hidden.list' ? '隐藏库' : '改过的'), 造('span.伸')));
        const 装 = 造('div', 造('div.装填', '读着…'));
        右.append(装);
        const { 回, 耗时 } = await 宿主.调(模块, 动作, {});
        if (!还作数(这一趟)) return;
        清(装);
        const 名单 = 名单出(回, 装);
        if (!名单) return;
        装.append(造('div.栏头', 造('span.数', `${名单.length} 条 · ${说秒(耗时)}`)));
        if (!名单.length) { 装.append(造('div.空', 空话)); return; }
        画卡们(装, 名单, {});
      }

      // ---------- 换路 ----------

      async function 换路(路) {
        状态.代数 += 1;
        状态.路 = 路;
        状态.页 = null;
        状态.类 = null;
        状态.全部名单 = [];
        状态.画到 = 0;
        搜框.style.display = 路 === '查库' ? '' : 'none';
        左.style.display = (路 === '全部' || 路 === '分类') ? '' : 'none';
        清(右);
        if (路 === '全部') { 状态.选中.clear(); 画底(); await 读全部(); return; }
        if (路 === '查库') { 画底(); 右.append(造('div.空', '在上面那个框里敲一个词。')); 搜.focus?.(); return; }
        if (路 === '分类') { await 分类那一块(); return; }
        if (路 === '收藏') { await 读收藏(); return; }
        if (路 === '隐藏库') { await 读名单('hidden.list', '隐藏库里没有东西。'); return; }
        await 读名单('modified.list', '没有改过的记录。');
      }

      /** 「分类」这一路：光看树，不挖成员。 */
      async function 分类那一块() {
        清(右);
        右.append(造('div.栏头', 造('h2', '分类'), 造('span.伸'), 造('span.数', '左边点一页或一个类，卡片铺在这儿')));
        const 树 = await 读分类树();
        if (!树) return;
        if (!树.length) { 右.append(造('div.空', '分类是空的。')); return; }
        右.append(造('div.提示.淡', '分类与配色都是模块给的：`position.list` 交出来的每个页与类都带一份。'));
        画一类的头(树[0], null);
      }

      // ---------- 批量：复制 / 存进收藏 / 清空 ----------

      复制.addEventListener('click', async () => {
        const 文 = await 拼已选();
        if (!文) return;
        try {
          await navigator.clipboard.writeText(文);
          吐司(`复制了 ${状态.选中.size} 个标签`, '成');
        } catch (_) { 吐司('复制不了', '错'); }
      });

      清空.addEventListener('click', () => {
        状态.选中.clear();
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) 卡.setAttribute('aria-selected', 'false');
      });

      存藏.addEventListener('click', async () => {
        if (!状态.选中.size) return;
        const { 回 } = await 宿主.调(模块, 'position.list', { 位置: '收藏' });
        if (!回 || 回.ok === false) { 吐司(`读不到收藏：${(回 && 回.reason) || '没回话'}`, '错'); return; }
        const 页们 = (Array.isArray(回) ? 回 : []).flatMap((页) => (页.类列表 || []).map((类) => ({ 页, 类 })));
        if (!页们.length) {
          吐司('收藏里还没有页和类：先在「收藏」那一路建一页一个类', '警', 4200);
          return;
        }
        const 选 = 造('select', 页们.map((一) => 造('option', { value: `${一.页.ID}/${一.类.ID}` }, `${一.页.页名} / ${一.类.类名}`)));
        const 结果 = await 要人填({
          标题: `把这 ${状态.选中.size} 个词存进收藏`,
          身: 造('div.字段', 造('div.标', '存到哪一格'), 选),
          确定: '存进去',
          要: () => 选.value,
        });
        if (!结果) return;
        const [页ID, 类ID] = String(结果).split('/');
        const 名们 = [...状态.选中.values()].map((r) => 名称们(r)[0]).filter(Boolean);
        let 成 = 0;
        const 坏 = [];
        for (const 一 of 状态.选中.values()) {
          const { 回: 这 } = await 宿主.调(模块, 'position.attach', {
            位置: '收藏', 页: 页ID, 类: 类ID, 成员: String(一.ID),
          });
          if (这 && 这.ok === false) 坏.push(`${名称们(一)[0] || 一.ID}：${这.reason}`);
          else 成 += 1;
        }
        if (坏.length) 吐司(`存了 ${成} 个，${坏.length} 个没成：${坏[0]}`, '警', 4200);
        else 吐司(`存了 ${成} 个（${名们.slice(0, 3).join(' · ')}${名们.length > 3 ? ' …' : ''}）`, '成');
      });

      // ---------- 详情：点开才读，读完才画 ----------

      const 关着的详情 = [];

      /** 一个元素底下第一个带这个类名的孩子。 */
      function 找孩子(元, 类) {
        if (typeof 元.querySelector === 'function') {
          const 中 = 元.querySelector(`.${类}`);
          if (中) return 中;
        }
        return (元.children || []).find((孩) => 孩.classList && 孩.classList.contains(类)) || null;
      }

      /**
       * 一条的详情：一屏里看全，改也在这一屏里改。
       * @param {object} 记录
       * @param {{页:object,类:object}} [位置] 从分类栏挖进来时带上，供以后按位置新建
       */
      async function 开详情(记录, 位置) {
        const 框 = 造('dialog.对框');
        框.append(
          造('div.对框头', 造('span', 名称们(记录)[0] || '（没名字）'), 造('span.标签', `#${记录.ID}`), 造('span.伸')),
          造('div.对框身', 造('div.装填', '读着…')),
          造('div.对框脚'),
        );
        (document.body || document.documentElement).append(框);
        if (typeof 框.showModal === 'function') 框.showModal();
        关着的详情.push(框);
        const 框身 = 找孩子(框, '对框身');
        const 脚 = 找孩子(框, '对框脚');
        const 关 = 造('button.钮', { type: 'button' }, '关上');
        关.addEventListener('click', () => {
          try { 框.close(); } catch (_) { /* 假 DOM 里没有 close */ }
          框.remove();
        });
        脚.append(关);

        const [{ 回: 详, 耗时 }, { 回: 注 }, { 回: 哪 }, { 回: 藏 }, { 回: 角 }] = await Promise.all([
          宿主.调(模块, 'record.get', { 标识: 记录.ID }),
          宿主.调(模块, 'note.get', { 标识: 记录.ID }),
          宿主.调(模块, 'position.whereIs', { 位置: '分类', 成员: String(记录.ID) }),
          宿主.调(模块, 'identity.isAdult', { 标识: 记录.ID }),
          宿主.调(模块, 'identity.isRole', { 标识: 记录.ID }),
        ]);
        清(框身);
        if (!详 || 详.ok === false) {
          框身.append(画回执({ 回: 详 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        const 记 = 详;

        // 上头那几行：名称 / 中文名 / 成员 / 摆在哪儿 / 注释
        const 头 = 造('div.块');
        const 行1 = 造('div.横排');
        行1.append(造('strong', { style: { fontFamily: 'Consolas, monospace' } }, 记.名称 || '（没名字）'));
        if (藏 === true) 行1.append(造('span.标签.警', '成人'));
        if (角 === true) 行1.append(造('span.标签.主', '角色组'));
        if (记.回显 === false) 行1.append(造('span.标签', '不参与检索'));
        头.append(行1);
        const 名 = 中文名们(记);
        头.append(造('div', { style: { marginTop: '6px' } },
          名.length ? `中文名：${名[0]}` : '还没有中文名。',
          ...(名.length > 1 ? [造('span.细节', ` · 还有 ${名.slice(1).join(' / ')}`)] : [])));
        const 别名 = 名称们(记).slice(1);
        if (别名.length) 头.append(造('div.细节', `别的写法：${别名.join(' / ')}`));
        if (Array.isArray(记.成员)) {
          头.append(造('div.细节', `组内成员 ${记.成员.length} 个：${记.成员.slice(0, 30).map((x) => `#${x}`).join(' ')}${记.成员.length > 30 ? ' …' : ''}`));
        }
        if (Array.isArray(哪) && 哪.length) 头.append(造('div.细节', `摆在：${哪.map((一) => `${一.页名} / ${一.类名}`).join(' · ')}`));
        头.append(造('div.细节', `注释：${注 && 注.ok !== false && 注 ? 注 : '（还没有注释）'}`));
        框身.append(头);

        // 改这一条：参数与控件照样从宿主读
        const 改块 = 造('div.块', { style: { marginTop: '10px' } });
        改块.append(造('h3', '改这一条'));
        const 输入 = {};
        for (const 名2 of ['名称', '中文名', '成员']) {
          const 一 = 宿主.参数(模块, 'record.edit', 名2) || { 名: 名2, 可选: 名2 !== '名称', 说明: '', 界面: { 控件: 'text' } };
          const 值 = 名2 === '成员' ? (记.成员 ? JSON.stringify(记.成员) : '') : (记[名2] || '');
          const { 元, 取值 } = 画一个参数(一, 值 === '' ? undefined : 值);
          输入[名2] = 取值;
          改块.append(元);
        }
        const 改放 = 造('div', { style: { marginTop: '8px' } });
        const 改钮 = 一个动作钮({
          话: 钮话(宿主, 'record.edit', '改'),
          主: true,
          做: async () => {
            const 参 = { 标识: 记.ID };
            const n = 输入.名称(); if (n !== undefined) 参.名称 = n;
            const z = 输入.中文名(); if (z !== undefined) 参.中文名 = z;
            const y = 输入.成员(); if (y !== undefined) 参.成员 = y;
            await 调并画('record.edit', 参, 改放);
            状态.选中.delete(String(记.ID));
            画底();
          },
        });
        改块.append(造('div.横排', { style: { marginTop: '8px' } }, 改钮.钮, 改钮.耗), 改放);
        框身.append(改块);

        // 注释
        const 注块 = 造('div.块', { style: { marginTop: '10px' } });
        注块.append(造('h3', '注释'));
        const 注框 = 造('textarea', { rows: 3 });
        注框.value = 注 && 注.ok !== false && 注 ? 注 : '';
        注块.append(注框);
        const 注放 = 造('div', { style: { marginTop: '8px' } });
        const 注钮 = 一个动作钮({
          话: '写注释',
          做: async () => { await 调并画('note.set', { 标识: 记.ID, 文本: 注框.value }, 注放); },
        });
        注块.append(造('div.横排', { style: { marginTop: '8px' } }, 注钮.钮, 注钮.耗), 注放);
        框身.append(注块);

        // 危险的那几个
        const 危块 = 造('div.块', { style: { marginTop: '10px' } });
        危块.append(造('h3', '危险的那几个'));
        危块.append(造('div.细节', '删只对自建库那条路有效；原有记录只能隐藏。失败时模块自己会说理由。'));
        const 危行 = 造('div.钮组', { style: { marginTop: '8px' } });
        const 危放 = 造('div', { style: { marginTop: '8px' } });
        for (const [动作, 兜底, 危] of [['hidden.hide', '隐藏', true], ['hidden.unhide', '还原', false], ['modified.restore', '还原原文', false], ['record.delete', '删', true]]) {
          if (!宿主.一条(模块, 动作)) continue;
          const 钮 = 一个动作钮({
            话: 钮话(宿主, 动作, 兜底),
            做: async () => {
              await 调并画(动作, { 标识: 记.ID }, 危放);
              状态.选中.delete(String(记.ID));
              画底();
            },
          });
          if (危) 钮.钮.classList.add('危');
          危行.append(钮.钮, 钮.耗);
        }
        危块.append(危行, 危放);
        框身.append(危块);
      }

      // ---------- 事件 ----------

      let 滴 = null;
      搜.addEventListener('input', () => {
        clearTimeout(滴);
        滴 = setTimeout(() => { if (状态.路 === '查库') 查库(); }, 320);
      });
      搜.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { clearTimeout(滴); 换路('查库').then(() => 查库()); }
      });
      重来.addEventListener('click', () => { 状态.位置树 = null; 换路(状态.路); });

      画底();
      // 起手那一趟要等：它先把分类读回来，再把第一类的卡片铺上。
      const 收尾 = () => {
        for (const 框 of 关着的详情) { try { 框.close(); } catch (_) { /* 关不掉就算了 */ } }
        关着的详情.length = 0;
      };
      return 换路('全部').then(() => 收尾, (错) => {
        清(右).append(造('div.提示.错', `起手那一趟没走完：${String((错 && 错.message) || 错)}`));
        return 收尾;
      });
    },
  };
}
