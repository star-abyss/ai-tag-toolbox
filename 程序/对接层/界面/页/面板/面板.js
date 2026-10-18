// 动作浏览器：把宿主交来的动作全列出来，点一个、填参数、原样看回执。
//
// 这是调试台那一块搬进了正式界面。留着它的理由：某块面板还没做，从这儿先用；
// 某块面板做坏了，从这儿对照看模块真正交出来什么。它**不认识任何模块**——
// 动作名、参数名、说明、控件全部来自宿主。
//
// 布局按 布局.md 的甲式（只有一栏清单，没有已选栏）：顶栏 / 工具条（搜索）/ 身子两栏 / 无底栏。
import { 造, 清, 画回执, 画一个参数, 说秒 } from '../顺手.js';

export default function 造面板面板() {
  return {
    名: '面板',
    标题: '全部动作',
    副题: '宿主交来的每一个动作，点着执行、回执原样看（调试台就在这儿）',
    要的模块: [],

    画(墙, { 宿主, 模子 }) {
      let 选中 = null;

      // ---------- 顶栏 ----------

      const 顶 = 造('div.墙顶');
      const 重取 = 造('button.钮.幽灵', { type: 'button', title: '重新向宿主要一次动作表' }, '重取桌面');
      重取.addEventListener('click', async () => {
        重取.disabled = true;
        const 桌 = await 宿主.重取桌();
        重取.disabled = false;
        if (!桌 || 桌.ok === false) { 数.textContent = `重取不了：${(桌 && 桌.reason) || '没回话'}`; return; }
        清(清单).append(造('div.提示.成', '动作表重取过了。外壳侧栏与模型条要按顶上那个「重读动作表」才跟着更新。'));
      });

      // ---------- 工具条 ----------

      const 搜 = 造('input', {
        type: 'search',
        placeholder: '搜动作名 / 摘要 / 参数名 / 说明（试试 miku、位置、出图）',
        autocomplete: 'off',
      });
      const 数 = 造('span.数');
      顶.append(
        造('div.横排', 造('span.伸'), 重取),
        造('div.分段条', 造('div.搜框', 造('span.镜', '⌕'), 搜), 数),
      );

      // ---------- 身子 ----------

      const 左 = 造('aside');
      const 右 = 造('section', { style: { minWidth: '0' } });
      const 身 = 造('div.墙身', 造('div.两栏', 左, 右));
      墙.append(顶, 身);

      const 清单 = 造('div.清单');
      左.append(清单);
      右.append(造('div.空', '左边挑一个动作。每个参数写一行：直接写文字就是字符串，要对象或数组就写 JSON。'));

      /** 按过滤词画左栏。 */
      function 画列(过滤) {
        const 词 = String(过滤 || '').trim().toLowerCase();
        清(清单);
        const 命中 = (宿主.桌.动作表 || []).filter((一) => {
          if (!词) return true;
          const 料 = [一.模块, 一.动作, 一.摘要, ...(一.参数 || []).map((p) => p.名), ...(一.参数 || []).map((p) => p.说明)].join(' ');
          return 料.toLowerCase().includes(词);
        });
        数.textContent = `${命中.length} / ${(宿主.桌.动作表 || []).length} 个动作`;
        if (!命中.length) { 清单.append(造('div.空', '没有对得上的动作。')); return; }

        let 上一个 = null;
        for (const 一 of 命中) {
          if (一.模块 !== 上一个) {
            上一个 = 一.模块;
            清单.append(造('div.栏头', { style: { marginTop: '10px' } },
              造('h3', 一.模块),
              造('span.伸'),
              造('span.数', String(命中.filter((x) => x.模块 === 一.模块).length))));
          }
          const 项 = 造('div.清单项', { dataset: { 模块: 一.模块, 动作: 一.动作 } });
          项.append(造('div.主行', 造('span.名', 一.动作)));
          项.append(造('div.副行', { title: 一.摘要 }, 一.摘要 || '（没写摘要）'));
          项.setAttribute('aria-selected', String(Boolean(选中 && 选中.模块 === 一.模块 && 选中.动作 === 一.动作)));
          项.addEventListener('click', () => 选中一个(一));
          清单.append(项);
        }
      }

      /** 画右栏：参数 + 执行 + 回执。 */
      function 选中一个(一) {
        选中 = 一;
        for (const 项 of 清单.querySelectorAll('.清单项')) {
          项.setAttribute('aria-selected', String(项.dataset.模块 === 一.模块 && 项.dataset.动作 === 一.动作));
        }
        location.hash = `#面板/${encodeURIComponent(一.模块)}/${encodeURIComponent(一.动作)}`;
        const 块 = 造('div.块');
        块.append(造('div.栏头',
          造('h3', 一.动作),
          造('span.标签.主', 一.模块),
          造('span.伸'),
          造('span.标签', `模型侧 ${一.模型侧 || '—'}`)));
        块.append(造('div.细节', 一.摘要 || '（没写摘要）'));
        清(右).append(块);

        const 取值们 = new Map();
        const 参块 = 造('div.块', { style: { marginTop: '12px' } });
        参块.append(造('div.栏头', 造('h3', '参数'), 造('span.伸'), 造('span.数', `${(一.参数 || []).length} 个`)));
        if (!(一.参数 || []).length) 参块.append(造('div.细节', '这个动作不收参数。'));
        for (const p of 一.参数 || []) {
          const { 元, 取值 } = 画一个参数(p);
          取值们.set(p.名, { 取值, 可选: p.可选 });
          参块.append(元);
        }
        右.append(参块);

        const 耗 = 造('span.耗时');
        const 钮 = 造('button.钮.主', { type: 'button' }, '执行');
        参块.append(造('div.块底', 钮, 耗));
        const 放 = 造('div');
        右.append(放);

        钮.addEventListener('click', async () => {
          const 参数 = {};
          for (const [名, { 取值, 可选 }] of 取值们) {
            const v = 取值();
            if (v === undefined) { if (!可选) 参数[名] = ''; continue; }
            参数[名] = v;
          }
          钮.disabled = true;
          钮.textContent = '跑着…';
          清(放);
          const { 回, 耗时 } = await 宿主.调(一.模块, 一.动作, 参数);
          钮.disabled = false;
          钮.textContent = '执行';
          耗.textContent = `${说秒(耗时)} · 参数 ${JSON.stringify(参数).slice(0, 120)}`;
          放.append(画回执({ 回, 耗时, 模子 }));
        });
      }

      let 滴 = null;
      搜.addEventListener('input', () => { clearTimeout(滴); 滴 = setTimeout(() => 画列(搜.value), 150); });
      搜.addEventListener('keydown', (e) => { if (e.key === 'Escape') { 搜.value = ''; 画列(''); } });

      画列('');

      // hash 里带 `#面板/<模块>/<动作>` 时直接摆开那一个。
      const 尾 = decodeURIComponent(String(location.hash || '')).split('/').slice(1);
      if (尾.length === 2) {
        const 一 = (宿主.桌.动作表 || []).find((x) => x.模块 === 尾[0] && x.动作 === 尾[1]);
        if (一) 选中一个(一);
      }
    },
  };
}
