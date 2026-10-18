// 装订面板：左边原文，右边对照与译名。
//
// 两条路的差别只是"谁来译"：
//   装订  交给 AI（要 DSH 的模型调用；界面这一侧没接，所以那一个动作会如实报缺）
//   本地译 交给本机模型（离线、不花钱）
// **切分只有一份**：两边各切一次、各过一遍「有内容的格」，格数才对得上——这是模块自己的
// 契约，界面照它做，不自己写第二套切法。
//
// 布局按 布局.md 的乙式：顶栏（方向 · 装订 · 本地译）/ 身子两栏对半 / 无底栏。
import { 造, 清, 画回执, 吐司 } from '../顺手.js';

const 装订 = 'binding';
const 翻译 = 'translate';

function 钮话(宿主, 模块, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

/** 一格画成一个格片：壳（前 / 后）淡，词亮；颜色说这一格的译名从哪来。 */
function 一格(单元, 出处) {
  const 盒 = 造('span', {
    style: { display: 'inline-block', margin: '0 4px 4px 0', padding: '1px 5px', borderRadius: '4px', background: 'var(--板硬)', fontFamily: 'Consolas, monospace', fontSize: '12px' },
    title: 出处 ? `出处：${出处}` : '',
  });
  if (单元.前) 盒.append(造('span', { style: { color: 'var(--字更淡)' } }, 单元.前));
  const 色 = 出处 === '库' ? 'var(--主字)' : 出处 === '模型' ? 'var(--警字)' : 'var(--字)';
  盒.append(造('span', { style: { color: 色 } }, 单元.词 || '（空）'));
  if (单元.后) 盒.append(造('span', { style: { color: 'var(--字更淡)' } }, 单元.后));
  return 盒;
}

export default function 造装订面板({ 宿主, 模子 }) {
  return {
    名: 'binding',
    标题: '装订 / 翻译',
    副题: '切分 · 查词 · 交给 AI 或本地模型 · 拼回',
    要的模块: [装订],

    画(墙) {
      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 方向参 = 宿主.参数(翻译, '本地译', '方向');
      const 方向选 = 造('select.窄');
      if (方向参 && 方向参.界面 && 方向参.界面.控件 === 'select' && 方向参.可选) {
        方向选.append(造('option', { value: '' }, '方向：（自动）'));
      }
      for (const 项 of (方向参 && 方向参.界面 && 方向参.界面.选项) || []) 方向选.append(造('option', { value: 项 }, 项));

      const 清钮 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      const 装钮 = 造('button.钮', { type: 'button' }, '装订（交给 AI）');
      const 译钮 = 造('button.钮.主', { type: 'button' }, '本地译');
      顶.append(造('div.横排', 造('label', '方向'), 方向选, 造('span.伸'), 清钮, 装钮, 译钮));
      顶.append(造('div.提示.警',
        '「装订」这条要 DSH 的模型调用。界面这一侧没接它（宿主装的时候「AI翻译」是空的），所以那个钮会如实报缺——报缺比假装能用好。'));

      // ---------- 身子 ----------

      const 左 = 造('section', { style: { minWidth: '0' } });
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.对半', 左, 右));
      墙.append(顶, 身);

      // 左：原文
      const 入块 = 造('div.块');
      const 数 = 造('span.数');
      入块.append(造('div.栏头', 造('h3', '要处理的那段文本'), 造('span.伸'), 数));
      const 输入 = 造('textarea', { rows: 14, placeholder: '1girl, smile, ((hatsune_miku)), <lora:abc:0.8>' });
      输入.addEventListener('input', () => { 数.textContent = `${输入.value.length} 字`; });
      const 切钮 = 造('button.钮.主', { type: 'button' }, '切分');
      入块.append(输入, 造('div.块底', 切钮, 造('span.伸'), 造('span.细节', '切分是纯函数：不给模型、不碰盘')));

      // 左：切出来的格
      const 格块 = 造('div.块', { style: { marginTop: '12px' } });
      格块.append(造('div.栏头', 造('h3', '原文的格'), 造('span.伸'), 造('span.数', '空单元也留着')));
      const 格放 = 造('div.格墙');
      格块.append(格放);
      左.append(入块, 格块);

      // 右：对照
      const 对块 = 造('div.块');
      对块.append(造('div.栏头', 造('h3', '原文 / 译文 对照'), 造('span.伸'), 造('span.数', '蓝=库 · 黄=模型 · 白=原词')));
      const 对放 = 造('div');
      对放.append(造('div.细节', '译一次就会在这儿一行一格摆开。'));
      对块.append(对放);
      右.append(对块);

      // 右：译完那一句（成功/失败的落点）
      const 放 = 造('div', { style: { marginTop: '12px' } });
      右.append(放);

      /** 铺原文的格。 */
      function 铺格(单元们) {
        清(格放);
        if (!单元们.length) { 格放.append(造('div.空', '没有格。')); return; }
        for (const [i, 一] of 单元们.entries()) {
          const 格 = 造(`div.格${一.词 ? '' : '.空格'}`);
          格.append(造('span.序', `#${i + 1}`));
          const 字 = 造('span.字');
          if (一.前) 字.append(造('span', { style: { color: 'var(--字更淡)' } }, 一.前));
          字.append(一.词 || '（空）');
          if (一.后) 字.append(造('span', { style: { color: 'var(--字更淡)' } }, 一.后));
          格.append(字);
          格放.append(格);
        }
      }

      /** 原文 + 译文各切一次，配对摆开。 */
      function 画对照(原文, 译文, 出处表) {
        清(对放);
        const 左格 = (原文 || []).filter((一) => 一 && 一.词);
        const 右格 = (译文 || []).filter((一) => 一 && 一.词);
        if (!左格.length && !右格.length) { 对放.append(造('div.空', '两边都没有内容。')); return; }
        if (左格.length !== 右格.length) {
          对放.append(造('div.提示.警',
            `两边格数对不上：原文 ${左格.length} 格、译文 ${右格.length} 格。对照按少的那个画。`));
        }
        const n = Math.min(左格.length, 右格.length);
        for (let i = 0; i < n; i += 1) {
          const 出处 = 出处表 && 出处表[i] ? (出处表[i].出处 || '') : '';
          const 行 = 造('div.条');
          行.append(造('span.码', `#${i + 1}`));
          行.append(造('span', 一格(左格[i])));
          行.append(造('span', { style: { color: 'var(--字更淡)' } }, '→'));
          行.append(造('span', 一格(右格[i], 出处)));
          行.append(造('span.伸'));
          行.append(造('span.标签', 出处 || '—'));
          对放.append(行);
        }
        if (左格.length > n) 对放.append(造('div.细节', `原文还剩 ${左格.length - n} 格没配上。`));
      }

      /** 切一次。 */
      async function 切() {
        const { 回, 耗时 } = await 宿主.调(装订, '切分', { 文本: 输入.value });
        const 答 = Array.isArray(回) ? 回 : (回 && 回.单元) || [];
        if (!回 || 回.ok === false) {
          清(格放).append(画回执({ 回: 回 || { ok: false, reason: '宿主没回话', code: 'PAGE_EMPTY' }, 耗时, 模子 }));
          return [];
        }
        const 有内容的 = 答.filter((一) => 一 && typeof 一.词 === 'string' && 一.词 !== '');
        数.textContent = `${答.length} 格 · 有内容的 ${有内容的.length} 格`;
        铺格(答);
        吐司(`切了 ${答.length} 格（有内容的 ${有内容的.length} 格）· ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`, '淡', 2400);
        return 答;
      }

      // ---------- 动作 ----------

      清钮.addEventListener('click', () => {
        输入.value = '';
        数.textContent = '';
        清(格放);
        清(对放).append(造('div.细节', '译一次就会在这儿一行一格摆开。'));
        清(放);
      });

      切钮.addEventListener('click', async () => {
        切钮.disabled = true;
        await 切();
        切钮.disabled = false;
        清(对放).append(造('div.细节', '译一次就会在这儿一行一格摆开。'));
      });

      装钮.addEventListener('click', async () => {
        装钮.disabled = true;
        const 起 = Date.now();
        清(放).append(造('div.装填', '跑着（要问模型，可能慢）…'));
        const { 回, 耗时 } = await 宿主.调(装订, '装订', { 文本: 输入.value });
        装钮.disabled = false;
        清(放);
        if (回 && 回.ok !== false) {
          // 装订的回执**没有 data 外壳**：顶层就是 { ok, 译文, 原文 }。
          const 译文 = 回.译文 || '';
          const { 回: 切原 } = await 宿主.调(装订, '切分', { 文本: 回.原文 || 输入.value });
          const { 回: 切译 } = await 宿主.调(装订, '切分', { 文本: 译文 });
          画对照(Array.isArray(切原) ? 切原 : [], Array.isArray(切译) ? 切译 : [], null);
          清(放).append(造('div.提示.成', `译好了 · 原文 ${(回.原文 || '').length} 字 · 译文 ${译文.length} 字 · 用时 ${Date.now() - 起} 毫秒`));
        }
        放.append(画回执({ 回, 耗时, 模子, 收起: Boolean(回 && 回.ok !== false) }));
      });

      译钮.addEventListener('click', async () => {
        译钮.disabled = true;
        译钮.textContent = '译着…';
        清(放).append(造('div.装填', '本地模型译着…'));
        const 参数 = { 文本: 输入.value };
        if (方向选.value) 参数.方向 = 方向选.value;
        const { 回, 耗时 } = await 宿主.调(翻译, '本地译', 参数);
        译钮.disabled = false;
        译钮.textContent = '本地译';
        清(放);
        if (回 && 回.ok !== false) {
          const 译文 = 回.译文 || '';
          const { 回: 切原 } = await 宿主.调(装订, '切分', { 文本: 回.原文 || 输入.value });
          const { 回: 切译 } = await 宿主.调(装订, '切分', { 文本: 译文 });
          画对照(Array.isArray(切原) ? 切原 : [], Array.isArray(切译) ? 切译 : [], 回.表 || []);
          清(放).append(造('div.提示.成', `译好了 · 方向 ${回.方向 || 方向选.value || '自动'} · 译文 ${译文.length} 字 · ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`));
        }
        放.append(画回执({ 回, 耗时, 模子, 收起: Boolean(回 && 回.ok !== false) }));
      });
    },
  };
}
