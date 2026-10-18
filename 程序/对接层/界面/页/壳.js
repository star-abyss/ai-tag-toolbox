// 界面外壳：侧栏 · 顶条 · 面板切换 · 模型条。
//
// 外壳只管三件事：把动作表要到手、把面板挑出来画、把"这块还没做"如实说出来。
// 它不认识任何模块的动作名——面板自己声明要调哪几个动作，外壳只检查那些动作在不在。
//
// 面板的形状（每个面板文件交出来的东西）：
//   { 名, 标题, 副题, 要的模块, 画(容器, 上下文) }
//   画 可以交回一个"收拾"函数，切走时会被叫一次。

import { 造宿主, 清总账, 调过的 } from './宿主.js';
import { 造, 清, 吐司 } from './顺手.js';
import { 交出去, 接过来, 盯着 } from './交接.js';

import 标签面板 from './面板/tag.js';
import 收藏面板 from './面板/收藏.js';
import 标签组面板 from './面板/标签组.js';
import 角色库面板 from './面板/角色库.js';
import 图片面板 from './面板/图片.js';
import 世界书面板 from './面板/世界书.js';
import 装订面板 from './面板/装订.js';
import 翻译面板 from './面板/翻译.js';
import 识图面板 from './面板/识图.js';
import comfy面板 from './面板/comfy.js';
import 主AI面板 from './面板/主AI.js';
import 面板面板 from './面板/面板.js';

const 模子 = document.getElementById('回执模子');
const 导航 = document.getElementById('导航');
const 身 = document.getElementById('身');
const 顶标题 = document.getElementById('顶标题');
const 顶副 = document.getElementById('顶副');
const 模型条 = document.getElementById('模型条');
const 脚注 = document.getElementById('脚注');
const 牌副 = document.getElementById('牌副');

/** 面板工厂清单。顺序就是侧栏的顺序：先看得见的东西，后设置。 */
const 工厂们 = [
  标签面板, 收藏面板, 标签组面板, 角色库面板, 图片面板, 识图面板,
  装订面板, 翻译面板, 世界书面板, comfy面板, 主AI面板, 面板面板,
];

/** 造好的面板（工厂收宿主的上下文，所以拿到桌之后才造）。 */
let 面板们 = [];

let 宿主 = null;
let 当前 = null;
let 收拾上一个 = null;

/** 造面板：每块都收同一份上下文。 */
function 造面板们(上下文) {
  面板们 = 工厂们.map((造) => 造(上下文));
}

/** 面板要的模块在不在。不在就如实说缺谁，不画一半。 */
function 缺什么(面板) {
  return (面板.要的模块 || []).filter((键) => !宿主.有模块(键));
}

/** 画侧栏。 */
function 画导航() {
  清(导航);
  for (const 面板 of 面板们) {
    const 缺 = 缺什么(面板);
    const 项 = 造('div.导航项', { dataset: { 面板: 面板.名 }, class: 缺.length ? '缺' : '' });
    项.append(造('span.名', 面板.标题));
    if (缺.length) 项.append(造('span.数', '缺'));
    项.addEventListener('click', () => { location.hash = `#${面板.名}`; });
    导航.append(项);
  }
  标选();
}

/** 标一下当前选中的那一条。 */
function 标选() {
  for (const 项 of 导航.querySelectorAll('.导航项')) {
    项.setAttribute('aria-current', 项.dataset.面板 === (当前 && 当前.名) ? 'page' : 'false');
  }
}

/** 画模型条：两格模型各一个下拉，外加"在用哪一格"。 */
function 画模型条(模型) {
  清(模型条);
  if (!模型) return;
  if (!模型.目录) { 模型条.append(造('span.坏', '配置里没写「模型目录」')); return; }

  for (const [类别, 叫法] of [['vision', '识图模型'], ['translation', '翻译模型']]) {
    const 几格 = 模型[类别] || [];
    if (!几格.length) {
      模型条.append(造('span', `${叫法}：（目录里一格都没有）`));
      continue;
    }
    const 选 = 造('select', { title: `${叫法} —— 跑着换，不用重起` });
    选.append(造('option', { value: '' }, `${叫法}：（自动）`));
    for (const 一 of 几格) {
      选.append(造('option', {
        value: 一.id,
        disabled: !一.装好了,
      }, `${一.名字}（${一.id}）${一.装好了 ? '' : ` · 缺：${(一.缺什么 || []).join('；')}`}`));
    }
    选.value = 模型.这次用[类别] || '';
    选.addEventListener('change', async () => {
      选.disabled = true;
      const { 回 } = await 宿主.换模型(类别, 选.value);
      if (回 && 回.ok === false) {
        // 换不了不动现在用的那一格，如实说哪一步不行。
        选.value = 模型.这次用[类别] || '';
        吐司(`换不了${叫法}：${回.reason}${回.code ? `（${回.code}）` : ''}`, '错');
      } else {
        画模型条(回 && 回.data ? 回.data : 模型);
      }
      选.disabled = false;
    });
    模型条.append(选);
  }
}

/** 切到一块面板。 */
function 切(名) {
  const 面板 = 面板们.find((一) => 一.名 === 名) || 面板们[0];
  if (当前 && 当前.名 === 面板.名 && 身.dataset.画好了 === 面板.名) { 标选(); return; }
  if (typeof 收拾上一个 === 'function') { try { 收拾上一个(); } catch (_) { /* 收拾失败不该拦住切走 */ } }
  收拾上一个 = null;
  当前 = 面板;
  标选();

  顶标题.textContent = 面板.标题;
  顶副.textContent = 面板.副题 || '';
  清(身);
  身.dataset.画好了 = 面板.名;

  const 缺 = 缺什么(面板);
  if (缺.length) {
    身.append(造('div.提示.错', `这块要的模块没装上：${缺.join(' · ')}。宿主说了为什么：${
      (宿主.装不上 || []).filter((一) => 缺.includes(一.模块)).map((一) => `${一.模块}（${一.理由}）`).join('；') || '没给理由'}`));
    return;
  }
  try {
    const 回 = 面板.画(身, { 宿主, 模子, 交出去, 接过来, 盯着 });
    if (typeof 回 === 'function') 收拾上一个 = 回;
  } catch (错) {
    身.append(造('div.提示.错', `这块面板画不出来：${String((错 && 错.message) || 错)}`));
  }
}

/** 按 hash 切；hash 认不出来就切第一块。`#面板/模块/动作` 只算「面板」那一块。 */
function 按hash切() {
  const 整 = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  const 名 = 整.split('/')[0];
  切(名 || 面板们[0].名);
}

/** 起。 */
async function 起() {
  清(身).append(造('div.等', '正在向宿主要动作表…'));
  const 临时 = { 动作表: [], 装不上: [], 模型: null };
  const 探 = 造宿主(临时);
  const 桌 = await 探.重取桌();
  if (!桌 || 桌.ok === false) {
    清(身).append(造('div.提示.错', `拿不到动作表：${(桌 && 桌.reason) || '宿主没回话'}`));
    return;
  }
  宿主 = 造宿主(桌);
  造面板们({ 宿主, 模子, 交出去, 接过来, 盯着 });
  // 摆在窗口上：自检与浏览器控制台要看"面板真调过哪些动作"。
  globalThis.__调过的__ = 调过的;
  globalThis.__清总账__ = 清总账;
  画导航();
  画模型条(桌.模型);
  牌副.textContent = `V${桌.版本} · ${桌.动作表.length} 个动作 · ${宿主.模块们().length} 个模块`;
  脚注.append(
    造('div.行', { title: 桌.项目根 }, `项目根 ${桌.项目根}`),
  );
  if (桌.装不上 && 桌.装不上.length) {
    脚注.append(造('div.行.坏', { title: 桌.装不上.map((x) => `${x.模块}：${x.理由}`).join('\n') }, `装不上 ${桌.装不上.length} 个`));
  }
  按hash切();
}

window.addEventListener('hashchange', 按hash切);
document.getElementById('重读').addEventListener('click', async () => {
  const 桌 = await 宿主.重取桌();
  if (!桌 || 桌.ok === false) { 吐司(`重读不了：${(桌 && 桌.reason) || '宿主没回话'}`, '错'); return; }
  宿主 = 造宿主(桌);
  造面板们({ 宿主, 模子, 交出去, 接过来, 盯着 });
  globalThis.__宿主__ = 宿主;
  画导航();
  画模型条(桌.模型);
  牌副.textContent = `V${桌.版本} · ${桌.动作表.length} 个动作 · ${宿主.模块们().length} 个模块`;
  身.dataset.画好了 = '';
  切(当前 ? 当前.名 : 面板们[0].名);
});

起();
