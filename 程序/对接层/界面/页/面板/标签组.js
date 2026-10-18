// 标签组面板：**用户自己建的那些组**。
//
// 组是带 `成员` 的记录（`record.groups` 一次全给，实测 38169 个）。库里的两种组各有各的
// 去处 —— 角色组在「角色库」，系列组是角色库左栏的作品 —— 所以这一块只画**两张身份表
// 都不认的**那些（自建的组不在任何一张表里，正是这一类）。刚装好时它是空的。
//
// 布局按 布局.md 的甲式：顶栏 / 工具条（搜索）/ 身子两栏 / 底栏。
import { 造, 清, 画回执, 吐司, 要人填 } from '../顺手.js';
import { 标签模块, 一批, 档位, 命中, 一张组卡, 画已选, 拼起来, 名称们, 是自建组 } from './组.js';

const 模块 = 标签模块;
/** 档位固定三档，顺序就是左栏的顺序。 */
const 档们 = ['小组（≤3 个成员）', '中组（4–20 个）', '大组（20 个以上）'];

export default function 造标签组面板({ 宿主, 模子 }) {
  return {
    名: 'groups',
    标题: '标签组',
    副题: '自己建的组 · 按成员多少分档看',
    要的模块: [模块],

    画(墙) {
      const 状态 = {
        全部: [],            // 自建的那些组
        档: null,            // 左栏选中的档
        词: '',
        选中: new Map(),
        画到: 0,
        代数: 0,
      };
      const 还作数 = (这一趟) => 这一趟 === 状态.代数;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 重读 = 造('button.钮.幽灵', { type: 'button' }, '重读');
      顶.append(造('div.横排', 造('span.伸'), 重读));

      const 搜 = 造('input', { type: 'search', placeholder: '按组名 / 中文名 / ID 筛', autocomplete: 'off' });
      const 数 = 造('span.数');
      顶.append(造('div.分段条', 造('div.搜框', 造('span.镜', '⌕'), 搜), 数));

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.窄左', 左, 右));
      墙.append(顶, 身);

      // ---------- 底栏 ----------

      const 底 = 造('div.墙底');
      const 底数 = 造('span.数');
      const 复制 = 造('button.钮', { type: 'button' }, '复制');
      const 存藏 = 造('button.钮', { type: 'button' }, '存进收藏');
      const 清空 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      底.append(底数, 造('span.伸'), 清空, 存藏, 复制);
      墙.append(底);

      function 画底() {
        画已选(底数, 状态.选中);
        复制.disabled = !状态.选中.size;
        存藏.disabled = !状态.选中.size;
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

      /** 现在该看哪些组：按搜索词筛。 */
      function 筛出来() {
        return 状态.全部.filter((组) => 命中(组, 状态.词));
      }

      /** 左栏：三档 + 每档几条。 */
      function 画左栏(命中们) {
        清(左);
        左.append(造('div.栏头', 造('h2', '按成员分档'), 造('span.伸')));
        const 栏 = 造('div.类栏');
        const 全 = 造('button.类项', { type: 'button' });
        全.append(造('span.名', '全部'));
        全.append(造('span.伸'));
        全.append(造('span.数', String(命中们.length)));
        全.setAttribute('aria-selected', String(!状态.档));
        全.addEventListener('click', () => { 状态.档 = null; 画主体(); });
        栏.append(全);
        for (const 一 of 档们) {
          const 条 = 命中们.filter((组) => 档位(组) === 一).length;
          const 项 = 造('button.类项', { type: 'button' });
          项.append(造('span.名', 一));
          项.append(造('span.伸'));
          项.append(造('span.数', String(条)));
          项.setAttribute('aria-selected', String(状态.档 === 一));
          项.addEventListener('click', () => { 状态.档 = 一; 画主体(); });
          栏.append(项);
        }
        左.append(栏);
        左.append(造('div.细节', { style: { marginTop: '10px' } },
          '分档是界面按成员数算的：模块只给 `成员` 那个数组，不给档。'));
      }

      /** 主体：按当前档筛出来的那些，一批一批铺卡片。 */
      function 画主体() {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.画到 = 0;
        const 命中们 = 筛出来().filter((组) => !状态.档 || 档位(组) === 状态.档);
        数.textContent = `看 ${命中们.length} 个 / 共 ${状态.全部.length} 个`;
        清(右);
        右.append(造('div.栏头',
          造('h2', 状态.档 || '全部组'),
          造('span.伸'),
          造('span.数', `${命中们.length} 个`)));
        if (!命中们.length) {
          右.append(造('div.空', 状态.全部.length
            ? '这一档一个都没有。'
            : '一个自建组都没有：组是自己建的，库里原有的那两种（角色组 · 系列组）在「角色库」那一块。'));
          return;
        }
        const 放 = 造('div');
        右.append(放);
        续一批(放, 命中们, 这一趟);
      }

      function 续一批(放, 命中们, 这一趟) {
        const 从 = 状态.画到;
        const 到 = Math.min(从 + 一批, 命中们.length);
        if (!还作数(这一趟)) return;
        清(放);
        const 格 = 造('div.卡片们.标签墙');
        放.append(造('div.细节', { style: { marginBottom: '8px' } }, `显示 ${到} / ${命中们.length}`), 格);
        for (const 组 of 命中们.slice(从, 到)) {
          格.append(一张组卡(组, {
            选中: 状态.选中.has(String(组.ID)),
            点: 点卡片,
            哪一档: 档位(组).replace(/（.*?）$/, ''),
          }));
        }
        状态.画到 = 到;
        if (到 < 命中们.length) {
          const 再 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '10px' } },
            `再显示 ${Math.min(一批, 命中们.length - 到)} 个（还有 ${命中们.length - 到} 个）`);
          再.addEventListener('click', () => 续一批(放, 命中们, 这一趟));
          放.append(再);
        }
      }

      /** 重新要一次全量组，只留自建的那些。 */
      async function 重画() {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        清(左).append(造('div.装填', '读着…'));
        清(右).append(造('div.装填', '组可能有几万个，读着…'));
        const { 回, 耗时 } = await 宿主.调(模块, 'record.groups', {});
        if (!还作数(这一趟)) return;
        if (!回 || 回.ok === false) {
          const 坏 = 画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 });
          清(左).append(坏);
          清(右).append(坏);
          return;
        }
        const 全 = Array.isArray(回) ? 回 : [];
        状态.全部 = 全.filter(是自建组);
        状态.选中.clear();
        画底();
        画左栏(筛出来());
        画主体();
        数.textContent = `共 ${状态.全部.length} 个自建组（全部组 ${全.length} 个） · 读一遍 ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`;
      }

      // ---------- 事件 ----------

      let 滴 = null;
      搜.addEventListener('input', () => {
        clearTimeout(滴);
        滴 = setTimeout(() => { 状态.词 = 搜.value; 画左栏(筛出来()); 画主体(); }, 220);
      });
      重读.addEventListener('click', 重画);

      复制.addEventListener('click', async () => {
        const 文 = 拼起来(状态.选中, false);
        if (!文) return;
        try { await navigator.clipboard.writeText(文); 吐司(`复制了 ${状态.选中.size} 个组名`, '成'); } catch (_) { 吐司('复制不了', '错'); }
      });

      清空.addEventListener('click', () => {
        状态.选中.clear();
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) 卡.setAttribute('aria-selected', 'false');
      });

      存藏.addEventListener('click', async () => {
        if (!状态.选中.size) return;
        const { 回 } = await 宿主.调(模块, 'position.list', { 位置: '收藏' });
        const 页们 = (Array.isArray(回) ? 回 : []).flatMap((页) => (页.类列表 || []).map((类) => ({ 页, 类 })));
        if (!页们.length) { 吐司('收藏里还没有页和类：去「收藏」面板先建一页一个类', '警', 4200); return; }
        const 选 = 造('select', 页们.map((一) => 造('option', { value: `${一.页.ID}/${一.类.ID}` }, `${一.页.页名} / ${一.类.类名}`)));
        const 结果 = await 要人填({
          标题: `把这 ${状态.选中.size} 个组存进收藏`,
          身: 造('div.字段', 造('div.标', '存到哪一格'), 选),
          确定: '存进去',
          要: () => 选.value,
        });
        if (!结果) return;
        const [页ID, 类ID] = String(结果).split('/');
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
        else 吐司(`存了 ${成} 个`, '成');
      });

      // ---------- 起 ----------

      画底();
      重画();
    },
  };
}
