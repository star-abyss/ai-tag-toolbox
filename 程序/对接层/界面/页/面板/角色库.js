// 角色库面板：模块里那些角色组，按作品分。
//
// 作品是**类**：页「角色组」底下一个作品一个类，类名就是作品名，类成员是那个作品里的角色
// （决定 121）。没写作品的角色落在类「未分类」里。
// 两趟数据就够：① 页「角色组」的类清单（`position.list`）② 每个角色落在哪个类（`render.whereIs`）。
//
// 布局按 布局.md 的甲式：顶栏 / 工具条（搜索）/ 身子两栏 / 底栏（复制角色词 · 复制角色词与特征）。
import { 造, 清, 画回执, 吐司 } from '../顺手.js';
import { 标签模块, 一批, 没写作品, 命中, 一张组卡, 画已选, 名称们, 中文名们, 是角色组 } from './组.js';

const 模块 = 标签模块;
const 角色页名 = '角色组';
const 未分类名 = '未分类';

export default function 造角色库面板({ 宿主, 模子 }) {
  return {
    名: 'chars',
    标题: '角色库',
    副题: '角色组按作品分 · 复制角色词或角色词+特征',
    要的模块: [模块],

    画(墙) {
      const 状态 = {
        角色页: null,        // { ID, 页名, 类列表 }
        作品: null,          // 选中的作品名；null = 全部
        词: '',
        选中: new Map(),
        名单: [],            // 当前该铺的角色 ID
        记录: new Map(),     // 角色 ID → 记录（取过就留着）
        画到: 0,
        代数: 0,
      };
      const 还作数 = (这一趟) => 这一趟 === 状态.代数;
      /** 角色 ID → 作品名。 */
      const 作品缓存 = new Map();

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 重读 = 造('button.钮.幽灵', { type: 'button' }, '重读');
      const 搜 = 造('input', { type: 'search', placeholder: '按角色名 / 中文名筛（作品在左栏挑）', autocomplete: 'off' });
      const 数 = 造('span.数');
      顶.append(造('div.横排', 造('span.伸'), 重读));
      顶.append(造('div.分段条', 造('div.搜框', 造('span.镜', '⌕'), 搜), 数));

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.窄左', 左, 右));
      墙.append(顶, 身);

      // ---------- 底栏 ----------

      const 底 = 造('div.墙底');
      const 底数 = 造('span.数');
      const 复词 = 造('button.钮', { type: 'button' }, '复制角色词');
      const 复全 = 造('button.钮.主', { type: 'button' }, '复制角色词与特征');
      const 清空 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      底.append(底数, 造('span.伸'), 清空, 复词, 复全);
      墙.append(底);

      function 画底() {
        画已选(底数, 状态.选中);
        复词.disabled = !状态.选中.size;
        复全.disabled = !状态.选中.size;
        清空.disabled = !状态.选中.size;
      }

      function 点卡片(组) {
        const 键 = String(组.ID);
        if (状态.选中.has(键)) 状态.选中.delete(键);
        else 状态.选中.set(键, 组);
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) {
          卡.setAttribute('aria-selected', String(状态.选中.has(String(卡.dataset.标识))));
        }
      }

      /** 一栏里的一项：点它就把那一类的角色铺出来。 */
      function 写一项(名, 几) {
        const 项 = 造('button.类项', { type: 'button' });
        项.append(造('span.名', { title: 名 }, 名));
        项.append(造('span.伸'));
        项.append(造('span.数', String(几)));
        项.setAttribute('aria-selected', String(状态.作品 === 名));
        项.addEventListener('click', () => {
          状态.作品 = 名 === '全部角色' ? null : 名;
          标左();
          画主体();
        });
        return 项;
      }

      /** 左栏：作品 + 每个作品几个角色（页「角色组」底下的类就是作品）。 */
      function 画左栏() {
        const 页 = 状态.角色页;
        清(左);
        if (!页) { 左.append(造('div.空', '位置里没有「角色组」这一页。')); return; }
        const 类们 = 页.类列表 || [];
        const 总数 = 类们.reduce((n, c) => n + Number(c.几个 || 0), 0);
        左.append(造('div.栏头', 造('h2', '作品'), 造('span.伸'), 造('span.数', `${类们.length} 个`)));
        const 栏 = 造('div.类栏');
        栏.append(写一项('全部角色', 总数));
        for (const c of 类们) 栏.append(写一项(c.类名, c.几个 || 0));
        左.append(栏);
        左.append(造('div.细节', { style: { marginTop: '10px' } },
          '作品就是页「角色组」底下的类：一个作品一个类，类名是作品名，类成员是那个作品里的角色。'));
      }

      /** 让左栏的选中态跟上 状态.作品。 */
      function 标左() {
        for (const 项 of 左.querySelectorAll('.类项')) {
          const 名 = 项.querySelector('.名');
          项.setAttribute('aria-selected', String((名 && 名.textContent) === (状态.作品 || '全部角色')));
        }
      }

      /** 主体：按 状态.作品 / 状态.词 定出名单，再一批一批铺卡片。 */
      async function 画主体() {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.画到 = 0;
        const 页 = 状态.角色页;
        const 词 = String(状态.词 || '').trim();

        let 标 = [];
        if (页) {
          if (状态.作品) {
            const 类 = (页.类列表 || []).find((c) => c.类名 === 状态.作品);
            if (类) {
              const { 回 } = await 宿主.调(模块, 'position.members', { 位置: '分类', 页: 页.ID, 类: 类.ID });
              if (!还作数(这一趟)) return;
              标 = Array.isArray(回) ? 回.map(String) : [];
            }
          } else if (词) {
            // 全部：只在搜了词的时候才铺（三万多个角色一次性拉回来没有意义）
            const { 回 } = await 宿主.调(模块, 'query', { 串: 词, 上限: 240 });
            if (!还作数(这一趟)) return;
            const 候选 = Array.isArray(回) ? 回 : (回 && Array.isArray(回.候选) ? 回.候选 : []);
            标 = 候选.filter((c) => c.类型 !== '类' && c.记录 && c.记录.成员).map((c) => String(c.记录.ID));
          }
        }
        状态.名单 = 标;

        清(右);
        右.append(造('div.栏头',
          造('h2', 状态.作品 || (词 ? `搜「${词}」` : '全部角色')),
          造('span.伸'),
          造('span.数', 标.length ? `${标.length} 个` : '')));
        if (!标.length) {
          右.append(造('div.空', 状态.作品
            ? '这一类一个角色都没有。'
            : '左栏挑一个作品，或在上面搜一个角色名（全部角色三万多个，不一次铺开）。'));
          return;
        }
        const 放 = 造('div');
        右.append(放);
        续一批(放, 这一趟);
      }

      /** 一批 ID → 记录（取过的留着）。顺序按传进来的。 */
      async function 取记录(标) {
        const 缺 = 标.filter((id) => !状态.记录.has(id));
        for (let i = 0; i < 缺.length; i += 500) {
          const 片 = 缺.slice(i, i + 500);
          const { 回 } = await 宿主.调(模块, 'record.batch', { 标识列表: 片 });
          if (Array.isArray(回)) for (const r of 回) 状态.记录.set(String(r.ID), r);
        }
        return 标.map((id) => 状态.记录.get(id)).filter(Boolean);
      }

      function 续一批(放, 这一趟) {
        const 从 = 状态.画到;
        const 到 = Math.min(从 + 一批, 状态.名单.length);
        if (!还作数(这一趟)) return;
        清(放);
        const 格 = 造('div.卡片们.标签墙');
        放.append(造('div.细节', { style: { marginBottom: '8px' } }, `显示 ${到} / ${状态.名单.length}`), 格);
        格.append(造('div.装填', '取这几条…'));
        const 这一批 = 状态.名单.slice(从, 到);
        取记录(这一批).then((记录们) => {
          if (!还作数(这一趟)) return;
          清(格);
          for (const 组 of 记录们) {
            if (!是角色组(组) && !Array.isArray(组.成员)) continue;
            格.append(一张组卡(组, {
              选中: 状态.选中.has(String(组.ID)),
              点: 点卡片,
              哪一档: 看作品名(组),
            }));
          }
          状态.画到 = 到;
          if (到 < 状态.名单.length) {
            const 再 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '10px' } },
              `再显示 ${Math.min(一批, 状态.名单.length - 到)} 个（还有 ${状态.名单.length - 到} 个）`);
            再.addEventListener('click', () => 续一批(放, 这一趟));
            放.append(再);
          }
        });
      }

      /** 这个角色属于哪个作品：选中某一类时就是它，否则看缓存。 */
      function 看作品名(组) {
        const 键 = String(组 && 组.ID);
        if (状态.作品) return 状态.作品;
        return 作品缓存.get(键) || 没写作品;
      }

      /** 复制的第一种：只要角色词。 */
      function 拼角色词() {
        return [...状态.选中.values()].map((一) => 名称们(一)[0]).filter(Boolean).join(', ');
      }

      /**
       * 复制的第二种：一个角色一段 —— 角色词 · 作品 · 特征。
       * 顺序由模块的「渲染顺序」给（作品 → 发色 → 其他外貌 → 服装……）。
       */
      async function 拼角色词与特征() {
        const 行 = [];
        for (const 组 of 状态.选中.values()) {
          const { 回 } = await 宿主.调(模块, 'render.words', { 标识: String(组.ID) });
          if (回 && 回.ok !== false && 回.角色名) {
            const 词 = [回.作品, ...(回.块们 || []).flatMap((b) => b.词们)].filter(Boolean);
            行.push(回.角色名 + (词.length ? ', ' + 词.join(', ') : ''));
            const 中 = 中文名们(组)[0];
            if (中) 行.push(中);
            continue;
          }
          // 模块没给出词就退回"成员里第一位之后那些"
          const 名 = 名称们(组)[0] || String(组.ID);
          const { 回: 记录们 } = await 宿主.调(模块, 'record.batch', { 标识列表: (组.成员 || []).slice(1) });
          const 特征 = Array.isArray(记录们) ? 记录们.map((一) => 名称们(一)[0]).filter(Boolean) : [];
          行.push(名 + (特征.length ? ', ' + 特征.join(', ') : ''));
        }
        return 行.join('\n');
      }

      /**
       * 重新要一次：① 页「角色组」的类清单 ② 每个角色落在哪个类（记进 作品缓存）。
       * 计数与归属都从这两趟来，不把三万多条记录全拉回来。
       */
      async function 重画() {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        清(左).append(造('div.装填', '读着…'));
        清(右).append(造('div.装填', '读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, 'position.list', { 位置: '分类' });
        if (!还作数(这一趟)) return;
        const 页们 = Array.isArray(回) ? 回 : [];
        const 角色页 = 页们.find((p) => p.页名 === 角色页名);
        if (!角色页) {
          const 坏 = 画回执({ 回: { ok: false, reason: `位置里没有「${角色页名}」这一页`, code: 'PAGE_EMPTY' }, 耗时, 模子 });
          清(左).append(坏);
          清(右).append(坏);
          return;
        }
        状态.角色页 = 角色页;
        状态.选中.clear();
        状态.记录.clear();
        作品缓存.clear();
        画底();

        // 计数与"角色 → 作品"：一趟拿全（页「角色组」有 4050 个类，不逐个类问）
        const { 回: 归属 } = await 宿主.调(模块, 'render.pageMap', { 页: 角色页.ID });
        if (!还作数(这一趟)) return;
        const 几个 = new Map();
        for (const 一 of (Array.isArray(归属) ? 归属 : [])) {
          const 名 = 一.类名;
          几个.set(名, (几个.get(名) || 0) + 1);
          if (名 !== 未分类名 && !作品缓存.has(一.成员)) 作品缓存.set(一.成员, 名);
        }
        for (const c of 角色页.类列表 || []) c.几个 = 几个.get(c.类名) || 0;

        画左栏();
        await 画主体();
        数.textContent = `页「${角色页.页名}」${(角色页.类列表 || []).length} 个类 · 读一遍 ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`;
      }

      // ---------- 事件 ----------

      let 滴 = null;
      搜.addEventListener('input', () => {
        clearTimeout(滴);
        滴 = setTimeout(() => { 状态.词 = 搜.value; 画主体(); }, 220);
      });
      重读.addEventListener('click', 重画);

      清空.addEventListener('click', () => {
        状态.选中.clear();
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) 卡.setAttribute('aria-selected', 'false');
      });

      复词.addEventListener('click', async () => {
        const 文 = 拼角色词();
        if (!文) return;
        try { await navigator.clipboard.writeText(文); 吐司(`复制了 ${状态.选中.size} 个角色词`, '成'); } catch (_) { 吐司('复制不了', '错'); }
      });

      复全.addEventListener('click', async () => {
        if (!状态.选中.size) return;
        复全.disabled = true;
        复全.textContent = '拼着…';
        const 文 = await 拼角色词与特征();
        复全.disabled = false;
        复全.textContent = '复制角色词与特征';
        try {
          await navigator.clipboard.writeText(文);
          吐司(`复制了 ${状态.选中.size} 个（角色词 + 作品 + 特征）`, '成', 3200);
        } catch (_) { 吐司('复制不了', '错'); }
      });

      // ---------- 起 ----------

      画底();
      重画();
    },
  };
}
