// 翻译面板：左边输入，右边译文与出处。
//
// 它跟装订是同一条路，只有"谁来译"不同：这条交给本机模型（离线、不花钱）。
// **切分只有一份**：装配层把装订模块的切分递给翻译模块，两边切出来一定一样。
//
// 布局按 布局.md 的乙式：顶栏（方向 · 看模型 · 清空 · 本地译）/ 身子两栏对半 / 无底栏。
import { 造, 清, 画回执, 吐司 } from '../顺手.js';

const 翻译 = 'translate';
const 装订 = 'binding';

function 钮话(宿主, 模块, 动作, 兜底) {
  const 摘 = 宿主.摘要(模块, 动作);
  const 头 = 摘 ? 摘.split(/[:：]/)[0].trim() : '';
  return 头 || 兜底 || 动作;
}

/** 一格画成一个小片：壳（前 / 后）淡，词亮。 */
function 画一格(单元, 出处) {
  const 盒 = 造('span', {
    style: { padding: '1px 5px', borderRadius: '4px', background: 'var(--板硬)', fontFamily: 'Consolas, monospace', fontSize: '12px' },
    title: 出处 ? `出处：${出处}` : '',
  });
  if (单元.前) 盒.append(造('span', { style: { color: 'var(--字更淡)' } }, 单元.前));
  const 色 = 出处 === '库' ? 'var(--主字)' : 出处 === '模型' ? 'var(--警字)' : 'var(--字)';
  盒.append(造('span', { style: { color: 色 } }, 单元.词 || '（空）'));
  if (单元.后) 盒.append(造('span', { style: { color: 'var(--字更淡)' } }, 单元.后));
  return 盒;
}

export default function 造翻译面板({ 宿主, 模子 }) {
  return {
    名: 'translate',
    标题: '翻译',
    副题: '本地模型那条路：离线、不花钱 · 与装订共用同一份切分',
    要的模块: [翻译],

    画(墙) {
      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 方向参 = 宿主.参数(翻译, '本地译', '方向');
      const 方向选 = 造('select.窄');
      if (方向参 && 方向参.界面 && 方向参.界面.控件 === 'select' && 方向参.可选) {
        方向选.append(造('option', { value: '' }, '方向：（自动）'));
      }
      for (const 项 of (方向参 && 方向参.界面 && 方向参.界面.选项) || []) 方向选.append(造('option', { value: 项 }, 项));

      const 看模 = 造('button.钮.幽灵', { type: 'button' }, 钮话(宿主, 翻译, '看模型', '看模型'));
      const 清钮 = 造('button.钮.幽灵', { type: 'button' }, '清空');
      const 译钮 = 造('button.钮.主', { type: 'button' }, '本地译');
      顶.append(造('div.横排', 造('label', '方向'), 方向选, 造('span.伸'), 看模, 清钮, 译钮));

      // ---------- 身子 ----------

      const 左 = 造('section', { style: { minWidth: '0' } });
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏.对半', 左, 右));
      墙.append(顶, 身);

      // 左：输入
      const 入块 = 造('div.块');
      const 字数 = 造('span.数');
      入块.append(造('div.栏头', 造('h3', '输入'), 造('span.伸'), 字数));
      const 输入 = 造('textarea', { rows: 16, placeholder: '中文描述，或一行英文 Tag —— 都行' });
      输入.addEventListener('input', () => { 字数.textContent = `${输入.value.length} 字`; });
      入块.append(输入);
      const 模行 = 造('div', { style: { marginTop: '8px' } });
      入块.append(模行);
      左.append(入块);

      // 右：译文
      const 出块 = 造('div.块');
      const 出条 = 造('div.栏头', 造('h3', '译文'), 造('span.伸'));
      const 复制 = 造('button.钮.小.幽灵', { type: 'button' }, '复制');
      出条.append(复制);
      出块.append(出条);
      const 译区 = 造('div', {
        style: { minHeight: '160px', padding: '8px', background: 'var(--板硬)', border: '1px solid var(--线)', borderRadius: 'var(--圆)', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: '12px', lineHeight: '1.7' },
      }, '译好的那一份会摆在这儿。');
      出块.append(译区);
      右.append(出块);

      // 右：出处
      const 源块 = 造('div.块', { style: { marginTop: '12px' } });
      源块.append(造('div.栏头', 造('h3', '每一格的出处'), 造('span.伸'), 造('span.数', '库 > 模型 > 原词')));
      const 源放 = 造('div');
      源块.append(源放);
      右.append(源块);

      // 右：切分
      const 切块 = 造('div.块', { style: { marginTop: '12px' } });
      const 切钮 = 造('button.钮.小', { type: 'button' }, '切分');
      切块.append(造('div.栏头', 造('h3', '切出来的格'), 造('span.伸'), 切钮));
      切块.append(造('div.细节', '与装订模块同一份切法：认逗号（半角全角）、壳（括号 / 权重 / lora），空单元原样留着。'));
      const 切放 = 造('div.格墙', { style: { marginTop: '8px' } });
      切块.append(切放);
      右.append(切块);

      // 右：模型那一格（点「看模型」才填）
      const 模块 = 造('div.块', { style: { marginTop: '12px' } });
      模块.append(造('div.栏头', 造('h3', '本地翻译这一格')));
      模块.append(造('div.细节', `现在用：${(宿主.桌.模型 && 宿主.桌.模型.这次用.translation) || '（没有装好的翻译模型）'} · 模型条上可以换`));
      右.append(模块);

      /** 把格铺出来。 */
      function 铺格(单元们) {
        清(切放);
        if (!单元们.length) { 切放.append(造('div.空', '没有格。')); return; }
        for (const [i, 一] of 单元们.entries()) {
          const 格 = 造(`div.格${一.词 ? '' : '.空格'}`);
          格.append(造('span.序', `#${i + 1}`));
          const 字 = 造('span.字');
          if (一.前) 字.append(造('span', { style: { color: 'var(--字更淡)' } }, 一.前));
          字.append(一.词 || '（空）');
          if (一.后) 字.append(造('span', { style: { color: 'var(--字更淡)' } }, 一.后));
          格.append(字);
          切放.append(格);
        }
      }

      /** 出处表：一行一格。 */
      function 铺出处(表) {
        清(源放);
        if (!Array.isArray(表) || !表.length) { 源放.append(造('div.细节', '这一回模块没给出处表。')); return; }
        for (const [i, 一] of 表.entries()) {
          const 行 = 造('div.条');
          行.append(造('span.码', `#${i + 1}`));
          行.append(造('span.名', 一.词 || 一.原词 || ''));
          行.append(造('span.伸'));
          行.append(造('span', 一.中文名 || 一.译名 || ''));
          行.append(造('span.标签', 一.出处 || '—'));
          源放.append(行);
        }
      }

      // ---------- 动作 ----------

      看模.addEventListener('click', async () => {
        看模.disabled = true;
        const { 回, 耗时 } = await 宿主.调(翻译, '看模型', {});
        看模.disabled = false;
        if (回 && 回.ok !== false) {
          const dl = 造('dl');
          const 说 = (k, v) => dl.append(造('dt', k), 造('dd', typeof v === 'object' ? JSON.stringify(v) : String(v)));
          说('现在用哪一格', 回.模型 || 回.id || '（没有）');
          说('能本地译吗', 回.能本地译 === undefined ? '（模块没说）' : String(回.能本地译));
          说('缺什么', (回.缺 || []).join('；') || '什么都不缺');
          吐司(`本地翻译这一格：${回.模型 || 回.id || '没有'} · ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`, '淡', 3600);
          清(模块).append(造('div.栏头', 造('h3', '本地翻译这一格')), 造('div.细节', dl));
        } else {
          吐司(`看不了：${(回 && 回.reason) || '没回话'}`, '错');
        }
      });

      清钮.addEventListener('click', () => {
        输入.value = '';
        字数.textContent = '';
        清(译区).append('译好的那一份会摆在这儿。');
        清(源放);
        清(切放);
      });

      复制.addEventListener('click', async () => {
        const 文 = 译区.textContent;
        if (!文) return;
        try { await navigator.clipboard.writeText(文); 吐司('译文复制了', '成'); } catch (_) { 吐司('复制不了', '错'); }
      });

      切钮.addEventListener('click', async () => {
        切钮.disabled = true;
        const { 回 } = await 宿主.调(翻译, '切分', { 文本: 输入.value });
        切钮.disabled = false;
        const 答 = Array.isArray(回) ? 回 : (回 && 回.单元);
        if (Array.isArray(答)) 铺格(答);
        else { 清(切放).append(画回执({ 回, 模子 })); }
      });

      译钮.addEventListener('click', async () => {
        const 文本 = 输入.value;
        if (!文本.trim()) { 吐司('左边先贴一段文本', '警'); return; }
        译钮.disabled = true;
        译钮.textContent = '译着…';
        清(译区).append(造('span.等', '译着…（第一次要装模型，本机实测约 1～2 秒）'));
        const 参数 = { 文本 };
        if (方向选.value) 参数.方向 = 方向选.value;
        const { 回, 耗时 } = await 宿主.调(翻译, '本地译', 参数);
        译钮.disabled = false;
        译钮.textContent = '本地译';
        清(译区);
        if (!回 || 回.ok === false) {
          译区.append(造('div.提示.错', `译不了：${(回 && 回.reason) || '没回话'}${回 && 回.code ? `（${回.code}）` : ''}`));
          清(源放);
          清(切放);
          return;
        }
        const 译文 = 回.译文 || '';
        译区.append(译文 || '（模块给了空译文）');
        铺出处(回.表);
        // 两边各切一次：这是模块自己的契约（切分是同一份，所以格数一一对应）。
        const { 回: 切原 } = await 宿主.调(翻译, '切分', { 文本: 回.原文 || 文本 });
        if (Array.isArray(切原)) 铺格(切原);
        吐司(`译好了 · 方向 ${回.方向 || 方向选.value || '自动'} · 原文 ${(回.原文 || 文本).length} 字 · 译文 ${译文.length} 字 · ${耗时 < 1 ? '<1' : Math.round(耗时)} 毫秒`, '成', 3600);
      });
    },
  };
}
