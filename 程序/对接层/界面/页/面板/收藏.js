// 收藏面板：左边收藏的页与类，右边卡片墙，底下已选栏。
//
// 它跟标签面板是同一套动作（`position.*` + `record.batch`），只是位置换一个：
// 标签那块看「分类」（模块给的那棵树），这块看「收藏」（用户自己攒的那几格）。
//
// 布局按 布局.md 的甲式：顶栏 / 工具条（分段：收藏栏 / 建页建类）/ 身子两栏 / 底栏。
import { 造, 清, 画回执, 分段, 吐司, 要人填 } from '../顺手.js';
import { 标签模块, 一批, 一张组卡, 画已选, 拼起来, 名称们 } from './组.js';

const 模块 = 标签模块;

export default function 造收藏面板({ 宿主, 模子 }) {
  return {
    名: 'favs',
    标题: '收藏',
    副题: '自己攒的那几格 · 挑词、移出去、看里面有什么',
    要的模块: [模块],

    画(墙) {
      const 状态 = {
        选中: new Map(),
        页: null,
        类: null,
        名单: [],
        画到: 0,
        代数: 0,
      };
      const 还作数 = (这一趟) => 这一趟 === 状态.代数;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 重读 = 造('button.钮.幽灵', { type: 'button' }, '重读');
      顶.append(造('div.横排', 造('span.伸'), 重读));

      // ---------- 工具条 ----------

      const 视图 = 分段(
        [{ 值: '收藏栏' }, { 值: '建页建类' }],
        '收藏栏',
        (值) => 换段(值),
      );
      顶.append(造('div.分段条', 视图.元));

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.窄左', 左, 右));
      墙.append(顶, 身);

      // ---------- 底栏 ----------

      const 底 = 造('div.墙底');
      const 底数 = 造('span.数');
      const 复制 = 造('button.钮', { type: 'button' }, '复制');
      const 移出 = 造('button.钮', { type: 'button' }, '移出这一类');
      const 清空 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      底.append(底数, 造('span.伸'), 清空, 移出, 复制);
      墙.append(底);

      function 画底() {
        画已选(底数, 状态.选中);
        const 能移 = 状态.选中.size > 0 && Boolean(状态.页 && 状态.类);
        复制.disabled = !状态.选中.size;
        移出.disabled = !能移;
        清空.disabled = !状态.选中.size;
      }

      function 点卡片(记录) {
        const 键 = String(记录.ID);
        if (状态.选中.has(键)) 状态.选中.delete(键);
        else 状态.选中.set(键, 记录);
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) {
          卡.setAttribute('aria-selected', String(状态.选中.has(String(卡.dataset.标识))));
        }
      }

      /** 一张卡：名 · 中文名 · 成员数。 */
      function 一张卡(记录) {
        return 一张组卡(记录, {
          选中: 状态.选中.has(String(记录.ID)),
          点: 点卡片,
          哪一档: 记录.成员 ? `组 ${记录.成员.length}` : '',
        });
      }

      // ---------- 取数 ----------

      async function 重画左栏() {
        清(左).append(造('div.装填', '读着收藏…'));
        const { 回, 耗时 } = await 宿主.调(模块, 'position.list', { 位置: '收藏' });
        清(左);
        if (!回 || 回.ok === false) {
          左.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return null;
        }
        const 页们 = Array.isArray(回) ? 回 : [];
        左.append(造('div.栏头', 造('h2', '收藏栏'), 造('span.伸'), 造('span.数', `${页们.length} 页`)));
        if (!页们.length) {
          const 空 = 造('div.空', '收藏里一页都没有。用上面那个「建页建类」先建一页一个类。');
          左.append(空);
          return 页们;
        }
        const 栏 = 造('div.类栏');
        for (const 页 of 页们) {
          栏.append(造('div.条', 造('span.名', 页.页名), 造('span.伸'), 造('span.数', `${(页.类列表 || []).length} 类`)));
          for (const 类 of 页.类列表 || []) {
            const 项 = 造('button.类项', { type: 'button' });
            项.append(造('span.点', { style: { background: (类.配色 || 页.配色 || {}).background || 'var(--线亮)' } }));
            项.append(造('span.名', 类.类名));
            项.setAttribute('aria-selected', String(Boolean(状态.类 && 状态.类.ID === 类.ID)));
            项.addEventListener('click', () => 看一类(页, 类));
            栏.append(项);
          }
        }
        左.append(栏);
        return 页们;
      }

      /** 看一个类里的东西。 */
      async function 看一类(页, 类) {
        const 这一趟 = 状态.代数 + 1;
        状态.代数 = 这一趟;
        状态.页 = 页;
        状态.类 = 类;
        状态.选中.clear();
        状态.名单 = [];
        状态.画到 = 0;
        画底();
        for (const 项 of 左.querySelectorAll('.类项')) 项.setAttribute('aria-selected', 'false');
        清(右).append(造('div.装填', `读着「${页.页名} / ${类.类名}」…`));
        const { 回, 耗时 } = await 宿主.调(模块, 'position.members', { 位置: '收藏', 页: 页.ID, 类: 类.ID });
        if (!还作数(这一趟)) return;
        清(右);
        if (!回 || 回.ok === false) {
          右.append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return;
        }
        状态.名单 = Array.isArray(回) ? 回 : [];
        右.append(造('div.栏头',
          造('h2', `${页.页名} / ${类.类名}`),
          造('span.伸'),
          造('span.数', `${状态.名单.length} 个 · 读这一格 ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`)));
        if (!状态.名单.length) {
          右.append(造('div.空', '这一格是空的。可以去「标签」那块挑几个词，按底下的「存进收藏」。'));
          return;
        }
        const 放 = 造('div');
        右.append(放);
        续一批(放, 类.配色 || 页.配色, 这一趟);
      }

      /** 一批一批画：收藏里也可能攒了几千个。 */
      function 续一批(放, 配色, 这一趟) {
        const 从 = 状态.画到;
        const 到 = Math.min(从 + 一批, 状态.名单.length);
        const 这一批 = 状态.名单.slice(从, 到);
        清(放);
        const 格 = 造('div.卡片们.标签墙');
        放.append(造('div.细节', { style: { marginBottom: '8px' } }, `显示 ${到} / ${状态.名单.length}`), 格);
        格.append(造('div.装填', '取这几条…'));
        宿主.调(模块, 'record.batch', { 标识列表: 这一批 }).then(({ 回 }) => {
          if (!还作数(这一趟)) return;
          清(格);
          if (!回 || 回.ok === false) {
            格.append(造('div.提示.错', `取不出来：${(回 && 回.reason) || '没回话'}`));
            return;
          }
          for (const 一 of (Array.isArray(回) ? 回 : [])) {
            const 卡 = 一张卡(一);
            if (配色) 卡.style.borderLeftColor = 配色.background || 'var(--线亮)';
            格.append(卡);
          }
          状态.画到 = 到;
          if (到 < 状态.名单.length) {
            const 再 = 造('button.钮.幽灵', { type: 'button', style: { marginTop: '10px' } },
              `再显示 ${Math.min(一批, 状态.名单.length - 到)} 个（还有 ${状态.名单.length - 到} 个）`);
            再.addEventListener('click', () => 续一批(放, 配色, 这一趟));
            放.append(再);
          }
        });
      }

      // ---------- 建页建类 ----------

      const 建段 = 造('div');
      {
        const 说明 = 造('div.提示.淡',
          '收藏里的一格 = 一页 + 一个类。**建页与建类是两步**：先有页，才谈得上往页底下加类。配色可给可不给。');
        建段.append(说明);

        const 块1 = 造('div.块', { style: { marginTop: '12px' } });
        块1.append(造('div.栏头', 造('h3', '建一页'), 造('span.伸'), 造('span.数', 'position.createPage')));
        const 页名框 = 造('input', { type: 'text', placeholder: '页名（可以重名，标识是 ID）' });
        const 页色框 = 造('input', { type: 'text', placeholder: '#335577（可空）' });
        块1.append(造('div.字段.满', 造('div.标', '页名'), 页名框));
        块1.append(造('div.字段.窄', { style: { marginTop: '6px' } }, 造('div.标', '配色底', 造('span.可选', '可选')), 页色框));
        const 建页钮 = 造('button.钮.主', { type: 'button' }, '建这一页');
        建页钮.addEventListener('click', async () => {
          const 页名 = 页名框.value.trim();
          if (!页名) { 吐司('先写一个页名', '警'); return; }
          建页钮.disabled = true;
          const 配色 = 页色框.value.trim() ? { background: 页色框.value.trim(), foreground: '#ffffff' } : undefined;
          const { 回 } = await 宿主.调(模块, 'position.createPage', { 位置: '收藏', 页名, 配色 });
          建页钮.disabled = false;
          if (!回 || 回.ok === false) { 吐司(`建不了：${(回 && 回.reason) || '没回话'}`, '错'); return; }
          页名框.value = '';
          页色框.value = '';
          吐司(`建好了：${页名}`, '成');
          await 重画左栏();
        });
        块1.append(造('div.块底', 建页钮));
        建段.append(块1);

        const 块2 = 造('div.块', { style: { marginTop: '12px' } });
        块2.append(造('div.栏头', 造('h3', '建一个类'), 造('span.伸'), 造('span.数', 'position.createClass')));
        const 挂哪 = 造('select');
        const 类名框 = 造('input', { type: 'text', placeholder: '类名' });
        const 类色框 = 造('input', { type: 'text', placeholder: '#775533（可空）' });
        块2.append(造('div.字段.满', 造('div.标', '挂哪一页'), 挂哪));
        块2.append(造('div.字段.满', { style: { marginTop: '6px' } }, 造('div.标', '类名'), 类名框));
        块2.append(造('div.字段.窄', { style: { marginTop: '6px' } }, 造('div.标', '配色底', 造('span.可选', '可选')), 类色框));
        const 建类钮 = 造('button.钮.主', { type: 'button' }, '建这个类');
        建类钮.addEventListener('click', async () => {
          const 类名 = 类名框.value.trim();
          const 页ID = 挂哪.value;
          if (!页ID) { 吐司('先建一页，再往它底下加类', '警'); return; }
          if (!类名) { 吐司('先写一个类名', '警'); return; }
          建类钮.disabled = true;
          const 配色 = 类色框.value.trim() ? { background: 类色框.value.trim(), foreground: '#ffffff' } : undefined;
          const { 回 } = await 宿主.调(模块, 'position.createClass', { 位置: '收藏', 页: 页ID, 类名, 配色 });
          建类钮.disabled = false;
          if (!回 || 回.ok === false) { 吐司(`建不了：${(回 && 回.reason) || '没回话'}`, '错'); return; }
          类名框.value = '';
          类色框.value = '';
          吐司(`建好了：${类名}`, '成');
          await 重画左栏();
        });
        块2.append(造('div.块底', 建类钮));
        建段.append(块2);

        /** 段切到「建页建类」时把页清单填进那个下拉。 */
        建段.填页 = async () => {
          const { 回 } = await 宿主.调(模块, 'position.list', { 位置: '收藏' });
          const 页们 = Array.isArray(回) ? 回 : [];
          清(挂哪);
          if (!页们.length) { 挂哪.append(造('option', { value: '' }, '（还没有页，先建一页）')); return; }
          for (const 页 of 页们) 挂哪.append(造('option', { value: String(页.ID) }, 页.页名));
        };
      }

      // ---------- 换段 ----------

      let 现在段 = '收藏栏';
      async function 换段(值) {
        现在段 = 值;
        const 建着 = 值 === '建页建类';
        左.style.display = 建着 ? 'none' : '';
        底.style.display = 建着 ? 'none' : '';
        清(右);
        if (建着) {
          右.append(建段);
          await 建段.填页();
          return;
        }
        await 重画左栏();
        右.append(造('div.空', '左边挑一格看里面有什么。'));
      }

      // ---------- 底栏那几个动作 ----------

      复制.addEventListener('click', async () => {
        const 文 = 拼起来(状态.选中, false);
        if (!文) return;
        try { await navigator.clipboard.writeText(文); 吐司(`复制了 ${状态.选中.size} 个`, '成'); } catch (_) { 吐司('复制不了', '错'); }
      });

      清空.addEventListener('click', () => {
        状态.选中.clear();
        画底();
        for (const 卡 of 右.querySelectorAll('.卡片')) 卡.setAttribute('aria-selected', 'false');
      });

      移出.addEventListener('click', async () => {
        if (!状态.选中.size || !状态.页 || !状态.类) return;
        const 是 = await 要人填({
          标题: `把这 ${状态.选中.size} 个从「${状态.类.类名}」里拿出来？`,
          身: 造('div.细节', '只是从这一格里拿掉，词本身还在库里。'),
          确定: '拿出来',
          要: () => true,
        });
        if (!是) return;
        let 成 = 0;
        const 坏 = [];
        for (const 一 of 状态.选中.values()) {
          const { 回 } = await 宿主.调(模块, 'position.detach', {
            位置: '收藏', 页: 状态.页.ID, 类: 状态.类.ID, 成员: String(一.ID),
          });
          if (回 && 回.ok === false) 坏.push(`${名称们(一)[0] || 一.ID}：${回.reason}`);
          else 成 += 1;
        }
        if (坏.length) 吐司(`移出 ${成} 个，${坏.length} 个没成：${坏[0]}`, '警', 4200);
        else 吐司(`移出 ${成} 个`, '成');
        await 看一类(状态.页, 状态.类);
      });

      重读.addEventListener('click', () => 换段(现在段));

      // ---------- 起 ----------

      画底();
      换段('收藏栏');
    },
  };
}
