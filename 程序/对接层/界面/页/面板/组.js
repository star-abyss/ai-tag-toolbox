// 标签组与角色库共用的那一份：取数 · 分档 · 卡片。
//
// 这两块读的是同一个动作（`record.groups`，一次给全部组，实测 38169 个：
// 角色组 34120 + 系列组 4049），只是看的东西不同：标签组看**用户自己建的组**
// （两张身份表都不认的那些），角色库看**角色组**、按**系列组**分作品。
// 取数与卡片放这儿一份，两块的取数口径就不会各写一遍。
//
// 界面这一侧不缓存数据：每次进面板重新要一次，`重读` 也是重新要。
import { 造 } from '../顺手.js';

export const 标签模块 = 'tag';

/** 一次最多画多少张：几万条一次全画会把页面拖死。 */
export const 一批 = 240;

/** 组的成员数落在哪个档。 */
export function 档位(组) {
  const n = (组.成员 || []).length;
  if (n <= 3) return '小组（≤3 个成员）';
  if (n <= 20) return '中组（4–20 个）';
  return '大组（20 个以上）';
}

/** 身份表回答的那两条。 */
export const 是角色组 = (组) => Boolean(组 && 组.是角色组);
export const 是系列组 = (组) => Boolean(组 && 组.是系列组);

/** 用户自己组起来的：两张身份表都不认的那些。 */
export const 是自建组 = (组) => !是角色组(组) && !是系列组(组);

/** 没挂上任何系列的角色归到这一格。 */
export const 没写作品 = '（没写作品）';

/** 一条记录的中文名们。 */
export function 中文名们(记录) {
  return String(记录.中文名 || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 名称们：第一个是规范写法。 */
export function 名称们(记录) {
  return String(记录.名称 || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 一组摆在屏幕上叫什么：中文名主名，没有就用规范写法。 */
export function 组名(组) {
  return 中文名们(组)[0] || 名称们(组)[0] || String((组 && 组.ID) || '');
}

/**
 * 由"页「角色组」底下的类"算一张**角色 → 作品**的查询表。
 *
 * 作品是类名：一个作品一个类，类成员就是那个作品里的角色（决定 121）。
 * 落在「未分类」的就是没写作品。
 *
 * @param {(成员ID:string)=>object|null} classOf 查"这个角色落在哪个类里"，由面板用模块动作现取
 * @returns {(组:object)=>string} 给一个角色组，交它的作品名
 */
export function 作品表(classOf) {
  return (组) => {
    const 落 = classOf(String((组 && 组.ID) ?? ''));
    if (!落 || !落.类名 || 落.类名 === '未分类') return 没写作品;
    return 落.类名;
  };
}

/** 一组的标识（组也是记录，ID 在 `ID` 上）。 */
export const 组标识 = (组) => String(组.ID);

/** 按名字筛一组。 */
export function 命中(组, 词) {
  const 净 = String(词 || '').trim().toLowerCase();
  if (!净) return true;
  return `${组.名称 || ''} ${组.中文名 || ''} ${组.ID}`.toLowerCase().includes(净);
}

/**
 * 造一张组卡片。
 *
 * @param {object} 组 `{ ID, 名称, 中文名, 成员, 是角色组 }`
 * @param {object} 选项
 *   点(组)     点卡片
 *   选中       这一张现在选中没有
 *   角们       往右上角塞的钮（数组）
 *   哪一档     顶上那行小字
 */
export function 一张组卡(组, 选项 = {}) {
  const 卡 = 造('div.卡片', { dataset: { 标识: 组标识(组) } });
  const 名 = 名称们(组)[0] || '（没名字）';
  卡.append(造('div.名', { title: 名 }, 名));
  const 名们 = 中文名们(组);
  卡.append(造('div.译', 名们[0] || '（还没有中文名）'));

  const 底行 = 造('div.底行');
  if (选项.哪一档) 底行.append(造('span.标签', 选项.哪一档));
  if (是角色组(组)) 底行.append(造('span.标签.主', '角色组'));
  else if (是系列组(组)) 底行.append(造('span.标签.主', '系列组'));
  const 几 = (组.成员 || []).length;
  底行.append(造('span.标签', 几 ? `组 ${几}` : '空组'));
  卡.append(底行);

  if (选项.角们 && 选项.角们.length) {
    const 角 = 造('div.角', ...选项.角们);
    卡.append(角);
  }
  卡.setAttribute('aria-selected', String(Boolean(选项.选中)));
  if (选项.点) 卡.addEventListener('click', () => 选项.点(组));
  return 卡;
}

/** 底栏那个"已选 N 个"。 */
export function 画已选(底数, 选中) {
  底数.textContent = 选中.size ? `已选 ${选中.size} 个` : '一个都没选';
}

/** 把已选的拼成一段文本（复制用）。 */
export function 拼起来(选中, 带中文) {
  const 们 = [...选中.values()];
  const 行 = [];
  for (const 一 of 们) {
    const 名 = 名称们(一)[0] || '';
    const 中 = 中文名们(一)[0] || '';
    行.push(带中文 && 中 ? `${名}（${中}）` : 名);
  }
  return 行.filter(Boolean).join(', ');
}
